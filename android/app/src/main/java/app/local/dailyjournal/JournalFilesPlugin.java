package app.local.dailyjournal;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.view.View;
import android.net.Uri;
import android.provider.OpenableColumns;
import androidx.activity.result.ActivityResult;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.text.SimpleDateFormat;
import java.util.*;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;

@CapacitorPlugin(name = "JournalFiles")
public class JournalFilesPlugin extends Plugin {
    private static final long IMAGE_LIMIT = 100L * 1024 * 1024;
    private static final long ARCHIVE_LIMIT = 2L * 1024 * 1024 * 1024;
    private static final long MANIFEST_LIMIT = 20L * 1024 * 1024;
    private static final String IMAGE_PATTERN = "[0-9a-f-]{36}\\.(jpg|png|webp)";
    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    private File directory(String name, boolean cache) throws IOException {
        File file = new File(cache ? getContext().getCacheDir() : getContext().getFilesDir(), name);
        if (!file.isDirectory() && !file.mkdirs()) throw new IOException("无法创建本地目录，请检查存储空间");
        return file;
    }
    private File image(String name) throws IOException {
        if (name == null || !name.matches(IMAGE_PATTERN)) throw new IOException("图片文件名无效");
        return new File(directory("images", false), name);
    }
    private static String required(PluginCall call, String key) throws IOException {
        String value = call.getString(key);
        if (value == null || value.isEmpty()) throw new IOException("缺少参数：" + key);
        return value;
    }
    private void io(PluginCall call, Callable<JSObject> job) {
        worker.execute(() -> { try { call.resolve(job.call()); } catch (Exception error) { call.reject(error.getMessage() == null ? "本地文件操作失败" : error.getMessage(), null, error); } });
    }
    private static long copy(InputStream input, OutputStream output, long limit) throws IOException {
        byte[] buffer = new byte[64 * 1024]; long total = 0; int count;
        while ((count = input.read(buffer)) != -1) { total += count; if (total > limit) throw new IOException("文件超过允许大小"); output.write(buffer, 0, count); }
        return total;
    }
    private static String hash(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256"); byte[] buffer = new byte[64 * 1024]; int count;
        try (InputStream input = new FileInputStream(file)) { while ((count = input.read(buffer)) != -1) digest.update(buffer, 0, count); }
        StringBuilder result = new StringBuilder(); for (byte value : digest.digest()) result.append(String.format(Locale.ROOT, "%02x", value & 0xff)); return result.toString();
    }
    private static void removeTree(File file) throws IOException {
        File[] children = file.listFiles(); if (children != null) for (File child : children) removeTree(child);
        if (file.exists() && !file.delete()) throw new IOException("无法清理临时文件");
    }
    private File stage(String token) throws IOException {
        if (token == null || !token.matches("[0-9a-f-]{36}")) throw new IOException("临时备份编号无效");
        File file = new File(directory("stages", true), token);
        if (!file.isDirectory()) throw new IOException("临时备份已失效，请重新选择文件");
        return file;
    }
    private JSObject backupInfo(File file) {
        return new JSObject().put("path", file.getAbsolutePath()).put("name", file.getName()).put("size", file.length()).put("createdAt", file.lastModified());
    }
    private JSONArray manifestImages(JSONObject manifest) throws Exception {
        int version = manifest.getInt("version");
        if (!"daily-journal".equals(manifest.getString("format")) || (version != 1 && version != 2)) throw new IOException("备份格式或版本不支持");
        JSONArray notes = new JSONArray(manifest.getJSONObject("data").getJSONArray("notes").toString()), images = new JSONArray(); Set<String> names = new HashSet<>();
        if (version == 2) { JSONArray entries = manifest.getJSONObject("data").getJSONArray("entries"); for (int i = 0; i < entries.length(); i++) notes.put(entries.getJSONObject(i)); }
        for (int n = 0; n < notes.length(); n++) {
            JSONArray attachments = notes.getJSONObject(n).optJSONArray("images");
            if (attachments == null) attachments = new JSONArray();
            for (int i = 0; i < attachments.length(); i++) {
                JSONObject attachment = attachments.getJSONObject(i); String file = attachment.getString("file");
                if (!file.matches(IMAGE_PATTERN) || !names.add(file) || !attachment.getString("sha256").matches("[0-9a-f]{64}") || attachment.getLong("size") <= 0 || attachment.getLong("size") > IMAGE_LIMIT) throw new IOException("备份中的图片清单无效");
                images.put(attachment);
            }
        }
        return images;
    }
    private void verifyImages(JSONArray images, File imageDirectory) throws Exception {
        for (int i = 0; i < images.length(); i++) {
            JSONObject item = images.getJSONObject(i); File file = new File(imageDirectory, item.getString("file"));
            if (!file.isFile() || file.length() != item.getLong("size") || !hash(file).equals(item.getString("sha256"))) throw new IOException("图片缺失或校验失败：" + item.getString("file"));
        }
    }
    private static void zipFile(ZipOutputStream output, String name, File file) throws IOException {
        output.putNextEntry(new ZipEntry(name)); try (InputStream input = new FileInputStream(file)) { copy(input, output, ARCHIVE_LIMIT); } output.closeEntry();
    }
    private static void zipText(ZipOutputStream output, String name, String text) throws IOException {
        output.putNextEntry(new ZipEntry(name)); output.write(text.getBytes(StandardCharsets.UTF_8)); output.closeEntry();
    }

    @PluginMethod public void info(PluginCall call) {
        io(call, () -> {
            // 只清理上次进程遗留、超过一天的中间文件；从不清理正式备份。
            File[] stages = directory("stages", true).listFiles(); long old = System.currentTimeMillis() - 86_400_000L;
            if (stages != null) for (File item : stages) if (item.lastModified() < old) removeTree(item);
            File[] exports = directory("exports", true).listFiles();
            if (exports != null) for (File item : exports) if (item.lastModified() < old) removeTree(item);
            File[] backups = directory("backups", false).listFiles((dir, name) -> name.endsWith(".zip")); JSArray list = new JSArray();
            if (backups != null) { Arrays.sort(backups, Comparator.comparingLong(File::lastModified).reversed()); for (File file : backups) list.put(backupInfo(file)); }
            return new JSObject().put("imageDirectory", Uri.fromFile(directory("images", false)).toString()).put("backups", list);
        });
    }
    @PluginMethod public void setSystemBars(PluginCall call) {
        String background = call.getString("background", "#f5f6f4");
        if (!background.matches("#[0-9a-fA-F]{6}")) { call.reject("颜色无效"); return; }
        boolean darkIcons = call.getBoolean("darkIcons", true);
        getActivity().runOnUiThread(() -> {
            WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getActivity().getWindow(), getActivity().getWindow().getDecorView());
            controller.setAppearanceLightStatusBars(darkIcons); controller.setAppearanceLightNavigationBars(darkIcons);
            ((View) getBridge().getWebView().getParent()).setBackgroundColor(Color.parseColor(background));
            call.resolve();
        });
    }
    @PluginMethod public void pickImages(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("image/*");
        intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"image/jpeg", "image/png", "image/webp"}); intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        intent.putExtra(Intent.EXTRA_LOCAL_ONLY, true); startActivityForResult(call, intent, "imagesSelected");
    }
    @ActivityCallback private void imagesSelected(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) { call.resolve(new JSObject().put("cancelled", true).put("images", new JSArray())); return; }
        Intent data = result.getData(); List<Uri> uris = new ArrayList<>();
        if (data.getClipData() != null) for (int i = 0; i < data.getClipData().getItemCount(); i++) uris.add(data.getClipData().getItemAt(i).getUri());
        else if (data.getData() != null) uris.add(data.getData());
        io(call, () -> {
            JSArray images = new JSArray(); List<File> created = new ArrayList<>();
            try {
                for (Uri uri : uris) {
                    String mime = getContext().getContentResolver().getType(uri), extension;
                    if ("image/jpeg".equals(mime)) extension = "jpg"; else if ("image/png".equals(mime)) extension = "png"; else if ("image/webp".equals(mime)) extension = "webp"; else throw new IOException("目前支持 JPG、PNG、WebP 图片");
                    String filename = UUID.randomUUID() + "." + extension, display = filename; File target = image(filename); created.add(target);
                    try (Cursor cursor = getContext().getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) { if (cursor != null && cursor.moveToFirst()) { String name = cursor.getString(0); if (name != null) display = name.substring(0, Math.min(300, name.length())); } }
                    try (InputStream input = getContext().getContentResolver().openInputStream(uri); OutputStream output = new FileOutputStream(target)) { if (input == null || copy(input, output, IMAGE_LIMIT) == 0) throw new IOException("图片为空或无法读取"); }
                    BitmapFactory.Options options = new BitmapFactory.Options(); options.inJustDecodeBounds = true; BitmapFactory.decodeFile(target.getAbsolutePath(), options);
                    if (options.outWidth <= 0 || options.outHeight <= 0) throw new IOException("图片文件损坏或无法识别");
                    images.put(new JSObject().put("file", filename).put("name", display).put("mime", mime).put("size", target.length()).put("sha256", hash(target)));
                }
                return new JSObject().put("images", images);
            } catch (Exception error) { for (File file : created) file.delete(); throw error; }
        });
    }
    @PluginMethod public void createBackup(PluginCall call) {
        io(call, () -> {
            String raw = required(call, "manifest"); if (raw.getBytes(StandardCharsets.UTF_8).length > MANIFEST_LIMIT) throw new IOException("备份清单过大");
            JSONArray images = manifestImages(new JSONObject(raw)); verifyImages(images, directory("images", false));
            long total = raw.getBytes(StandardCharsets.UTF_8).length;
            for (int i = 0; i < images.length(); i++) total += images.getJSONObject(i).getLong("size");
            if (total > ARCHIVE_LIMIT || images.length() + 1 > 20000) throw new IOException("备份超过 2 GB 或包含过多图片，请先分开导出内容");
            String stamp = new SimpleDateFormat("yyyyMMdd-HHmmss", Locale.ROOT).format(new Date());
            File target = new File(directory("backups", false), "backup-" + stamp + "-" + UUID.randomUUID().toString().substring(0, 8) + ".zip"); File partial = new File(target.getPath() + ".part");
            try {
                try (FileOutputStream fileOutput = new FileOutputStream(partial); ZipOutputStream output = new ZipOutputStream(fileOutput)) {
                    zipText(output, "manifest.json", raw);
                    for (int i = 0; i < images.length(); i++) { String name = images.getJSONObject(i).getString("file"); zipFile(output, "images/" + name, image(name)); }
                    output.finish(); output.flush(); fileOutput.getFD().sync();
                }
                if (!partial.renameTo(target)) throw new IOException("备份写入未完成");
                return backupInfo(target);
            } catch (Exception error) { partial.delete(); throw error; }
        });
    }
    @PluginMethod public void chooseBackup(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
        intent.putExtra(Intent.EXTRA_LOCAL_ONLY, true); startActivityForResult(call, intent, "backupSelected");
    }
    @ActivityCallback private void backupSelected(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) { call.resolve(new JSObject().put("cancelled", true)); return; }
        Uri uri = result.getData().getData();
        io(call, () -> {
            String token = UUID.randomUUID().toString(); File folder = new File(directory("stages", true), token);
            if (!folder.mkdirs()) throw new IOException("无法暂存备份");
            try {
                Set<String> names = new HashSet<>(); long total = 0; int count = 0;
                try (InputStream source = getContext().getContentResolver().openInputStream(uri)) {
                    if (source == null) throw new IOException("无法读取备份文件");
                    try (ZipInputStream input = new ZipInputStream(new BufferedInputStream(source))) {
                        ZipEntry entry;
                        while ((entry = input.getNextEntry()) != null) {
                            String name = entry.getName(); if (entry.isDirectory() && "images/".equals(name)) continue;
                            if (!("manifest.json".equals(name) || name.matches("images/" + IMAGE_PATTERN)) || !names.add(name) || ++count > 20000) throw new IOException("备份包含无效或重复文件");
                            File output = new File(folder, name);
                            if (!output.getCanonicalPath().startsWith(folder.getCanonicalPath() + File.separator)) throw new IOException("备份路径无效");
                            if (!output.getParentFile().isDirectory() && !output.getParentFile().mkdirs()) throw new IOException("无法解包备份");
                            long limit = Math.min("manifest.json".equals(name) ? MANIFEST_LIMIT : IMAGE_LIMIT, ARCHIVE_LIMIT - total);
                            try (OutputStream stream = new FileOutputStream(output)) { total += copy(input, stream, limit); }
                            input.closeEntry();
                        }
                    }
                }
                File manifestFile = new File(folder, "manifest.json"); if (!manifestFile.isFile()) throw new IOException("缺少备份清单");
                String raw = new String(Files.readAllBytes(manifestFile.toPath()), StandardCharsets.UTF_8); JSONArray images = manifestImages(new JSONObject(raw));
                if (names.size() != images.length() + 1) throw new IOException("图片清单与备份文件不一致");
                verifyImages(images, new File(folder, "images"));
                return new JSObject().put("token", token).put("manifest", raw);
            } catch (Exception error) { removeTree(folder); throw error; }
        });
    }
    @PluginMethod public void installImages(PluginCall call) {
        io(call, () -> {
            File folder = stage(required(call, "token")); JSONObject manifest = new JSONObject(new String(Files.readAllBytes(new File(folder, "manifest.json").toPath()), StandardCharsets.UTF_8));
            JSONArray images = manifestImages(manifest); verifyImages(images, new File(folder, "images"));
            for (int i = 0; i < images.length(); i++) {
                JSONObject item = images.getJSONObject(i); File target = image(item.getString("file"));
                if (target.exists()) { if (!hash(target).equals(item.getString("sha256"))) throw new IOException("本机存在同名不同内容的图片，已停止恢复"); continue; }
                File partial = new File(target.getPath() + ".part");
                try {
                    try (InputStream input = new FileInputStream(new File(folder, "images/" + target.getName())); FileOutputStream output = new FileOutputStream(partial)) { copy(input, output, IMAGE_LIMIT); output.getFD().sync(); }
                    if (!partial.renameTo(target)) throw new IOException("无法保存恢复的图片");
                } finally { partial.delete(); }
            }
            return new JSObject();
        });
    }
    @PluginMethod public void discardStage(PluginCall call) { io(call, () -> { String token = required(call, "token"); if (!token.matches("[0-9a-f-]{36}")) throw new IOException("临时文件编号无效"); removeTree(new File(directory("stages", true), token)); return new JSObject(); }); }
    @PluginMethod public void removeImages(PluginCall call) { io(call, () -> { JSArray names = call.getArray("images", new JSArray()); for (int i = 0; i < names.length(); i++) { File file = image(names.getString(i)); if (file.exists() && !file.delete()) throw new IOException("部分图片未能清理"); } return new JSObject(); }); }

    @PluginMethod public void deleteBackup(PluginCall call) {
        io(call, () -> { File file = exportSource(required(call, "path")); if (!file.getParentFile().getCanonicalFile().equals(directory("backups", false).getCanonicalFile()) || !file.getName().endsWith(".zip")) throw new IOException("只能删除应用内完整备份"); if (!file.delete()) throw new IOException("备份未能删除"); return new JSObject(); });
    }

    private File exportSource(String path) throws IOException {
        File file = new File(path).getCanonicalFile(); String value = file.getPath();
        if (!value.startsWith(directory("backups", false).getCanonicalPath() + File.separator) && !value.startsWith(directory("exports", true).getCanonicalPath() + File.separator)) throw new IOException("导出文件路径无效");
        if (!file.isFile()) throw new IOException("导出文件不存在"); return file;
    }
    @PluginMethod public void exportFile(PluginCall call) {
        try {
            exportSource(required(call, "path")); String name = required(call, "name").replaceAll("[/\\\\]", "_");
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(call.getString("mime", "application/octet-stream"));
            intent.putExtra(Intent.EXTRA_TITLE, name); intent.putExtra(Intent.EXTRA_LOCAL_ONLY, true); startActivityForResult(call, intent, "exportSelected");
        } catch (Exception error) { call.reject(error.getMessage(), null, error); }
    }
    @ActivityCallback private void exportSelected(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) { call.resolve(new JSObject().put("cancelled", true)); return; }
        Uri uri = result.getData().getData();
        io(call, () -> {
            File file = exportSource(required(call, "path"));
            try (InputStream input = new FileInputStream(file); OutputStream output = getContext().getContentResolver().openOutputStream(uri, "wt")) { if (output == null) throw new IOException("无法写入所选位置"); copy(input, output, Long.MAX_VALUE); }
            catch (Exception error) { try { getContext().getContentResolver().delete(uri, null, null); } catch (Exception ignored) { } throw error; }
            return new JSObject();
        });
    }
    @PluginMethod public void createTextExport(PluginCall call) {
        io(call, () -> {
            String name = required(call, "name"); if (name.contains("/") || name.contains("\\")) throw new IOException("导出名称无效");
            File target = new File(directory("exports", true), UUID.randomUUID() + "-" + name);
            try (FileOutputStream output = new FileOutputStream(target)) { output.write(required(call, "content").getBytes(StandardCharsets.UTF_8)); output.getFD().sync(); }
            return new JSObject().put("path", target.getAbsolutePath());
        });
    }
    @PluginMethod public void createNotesExport(PluginCall call) {
        io(call, () -> {
            JSONArray source = new JSONArray(required(call, "notes")); List<JSONObject> notes = new ArrayList<>();
            for (int i = 0; i < source.length(); i++) notes.add(source.getJSONObject(i));
            notes.sort(Comparator.<JSONObject>comparingInt(n -> n.optBoolean("pinned") ? 0 : 1).thenComparingLong(n -> n.optLong("position")));
            File target = new File(directory("exports", true), "notes-" + UUID.randomUUID() + ".zip");
            try (ZipOutputStream output = new ZipOutputStream(new FileOutputStream(target))) {
                StringBuilder index = new StringBuilder("# 日常记导出\n\n"); Set<String> writtenImages = new HashSet<>();
                for (JSONObject note : notes) {
                    String noteId = note.getString("id"); if (!noteId.matches("[\\w-]{1,100}")) throw new IOException("记录编号无效");
                    String title = note.getString("title").replace('\n', ' '); if (title.trim().isEmpty()) title = "无标题记录";
                    index.append("- ").append(title).append("：notes/").append(noteId).append(".md\n");
                    StringBuilder text = new StringBuilder("# ").append(title).append("\n\n创建时间：").append(new Date(note.getLong("createdAt"))).append("\n置顶：").append(note.getBoolean("pinned") ? "是" : "否").append("\n排序：").append(note.getLong("position")).append("\n\n").append(note.getString("body")).append("\n\n");
                    text.append("\n记录日期：").append(note.optString("recordDate", "")).append("\n标签：").append(note.optJSONArray("tagNames")).append("\n\n");
                    JSONArray todos = note.getJSONArray("todos");
                    for (int i = 0; i < todos.length(); i++) { JSONObject todo = todos.getJSONObject(i); text.append(todo.getBoolean("done") ? "- [x] " : "- [ ] ").append(todo.getString("text").replace('\n', ' ')).append('\n'); }
                    JSONArray images = note.getJSONArray("images");
                    for (int i = 0; i < images.length(); i++) { String name = images.getJSONObject(i).getString("file"); text.append("\n![](../images/").append(name).append(")\n"); if (writtenImages.add(name)) zipFile(output, "images/" + name, image(name)); }
                    zipText(output, "notes/" + noteId + ".md", text.toString());
                }
                zipText(output, "目录.md", index.toString());
            } catch (Exception error) { target.delete(); throw error; }
            return new JSObject().put("path", target.getAbsolutePath());
        });
    }
    @Override protected void handleOnDestroy() { worker.shutdown(); }
}
