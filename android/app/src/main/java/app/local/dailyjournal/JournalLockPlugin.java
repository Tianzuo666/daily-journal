package app.local.dailyjournal;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.view.WindowManager;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.SecureRandom;
import javax.crypto.KeyGenerator;
import javax.crypto.Mac;
import javax.crypto.SecretKey;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** 应用访问锁：凭据仅存于本机，文件备份不包含密码或密钥。 */
@CapacitorPlugin(name = "JournalLock")
public class JournalLockPlugin extends Plugin {
    private SharedPreferences prefs;
    private volatile boolean locked = true;
    private volatile long pausedAt = 0;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private static final String KEY = "daily_journal_pin_v2";

    @Override public void load() { prefs = getContext().getSharedPreferences("journal_lock", Context.MODE_PRIVATE); secureWindow(); }
    private boolean enabled() { return prefs.getBoolean("enabled", false); }
    private KeyguardManager manager() { return (KeyguardManager) getContext().getSystemService(Context.KEYGUARD_SERVICE); }
    private void secureWindow() {
        getActivity().runOnUiThread(() -> { if (enabled()) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE); else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE); });
    }
    private JSObject state() {
        if (enabled() && pausedAt > 0 && System.currentTimeMillis() - pausedAt >= 30_000) locked = true;
        return new JSObject().put("enabled", enabled()).put("locked", enabled() && locked).put("secure", manager().isDeviceSecure()).put("retryAfter", Math.max(0L, prefs.getLong("blockedUntil", 0) - System.currentTimeMillis()));
    }
    private void run(PluginCall call, Job job) { worker.execute(() -> { try { job.run(); } catch (Exception error) { call.reject(error.getMessage() == null ? "密码操作失败" : error.getMessage()); } }); }
    private interface Job { void run() throws Exception; }
    private String pin(PluginCall call) throws Exception { String value = call.getString("pin", ""); if (!value.matches("[0-9]{6}")) throw new Exception("请输入六位数字密码"); return value; }
    private void save(SharedPreferences.Editor edit) throws Exception { if (!edit.commit()) throw new Exception("密码设置未能保存，请重试"); }
    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (!store.containsAlias(KEY)) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_HMAC_SHA256, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(KEY, KeyProperties.PURPOSE_SIGN | KeyProperties.PURPOSE_VERIFY).setDigests(KeyProperties.DIGEST_SHA256).build()); generator.generateKey();
        }
        return (SecretKey) store.getKey(KEY, null);
    }
    private byte[] verifier(String value, byte[] salt) throws Exception {
        PBEKeySpec spec = new PBEKeySpec(value.toCharArray(), salt, 120_000, 256);
        byte[] derived;
        try { derived = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded(); } finally { spec.clearPassword(); }
        Mac mac = Mac.getInstance("HmacSHA256"); mac.init(key()); return mac.doFinal(derived);
    }
    private void check(String value) throws Exception {
        if (prefs.getLong("blockedUntil", 0) > System.currentTimeMillis()) throw new Exception("输错次数较多，请等待30秒后重试");
        boolean valid = value.matches("[0-9]{6}") && MessageDigest.isEqual(verifier(value, Base64.decode(prefs.getString("salt", ""), Base64.NO_WRAP)), Base64.decode(prefs.getString("verifier", ""), Base64.NO_WRAP));
        if (!valid) {
            int attempts = prefs.getInt("failures", 0) + 1;
            save(prefs.edit().putInt("failures", attempts >= 5 ? 0 : attempts).putLong("blockedUntil", attempts >= 5 ? System.currentTimeMillis() + 30_000 : 0));
            throw new Exception(attempts >= 5 ? "密码错误，请等待30秒后重试" : "密码错误");
        }
        save(prefs.edit().putInt("failures", 0).putLong("blockedUntil", 0)); locked = false; pausedAt = 0;
    }
    private void setPin(String value) throws Exception {
        if (!manager().isDeviceSecure()) throw new Exception("请先在手机设置中启用系统锁屏密码");
        byte[] salt = new byte[24]; new SecureRandom().nextBytes(salt);
        String hash = Base64.encodeToString(verifier(value, salt), Base64.NO_WRAP);
        save(prefs.edit().putBoolean("enabled", true).putString("salt", Base64.encodeToString(salt, Base64.NO_WRAP)).putString("verifier", hash).putInt("failures", 0).putLong("blockedUntil", 0));
        locked = false; pausedAt = 0; secureWindow();
    }
    @PluginMethod public void status(PluginCall call) { run(call, () -> call.resolve(state())); }
    @PluginMethod public void unlock(PluginCall call) { run(call, () -> { if (enabled()) check(pin(call)); call.resolve(state()); }); }
    @PluginMethod public void configure(PluginCall call) {
        run(call, () -> { if (enabled()) check(call.getString("currentPin", "")); if (call.getBoolean("disable", false)) { save(prefs.edit().clear()); locked = false; pausedAt = 0; secureWindow(); } else setPin(pin(call)); call.resolve(state()); });
    }
    @PluginMethod public void reset(PluginCall call) {
        try {
            pin(call); if (!enabled()) throw new Exception("尚未启用应用密码锁");
            Intent intent = manager().createConfirmDeviceCredentialIntent("重设日常记密码", "验证手机系统锁屏凭据后设置新的六位应用密码");
            if (intent == null) throw new Exception("请先设置手机系统锁屏凭据");
            startActivityForResult(call, intent, "resetVerified");
        } catch (Exception error) { call.reject(error.getMessage()); }
    }
    @ActivityCallback private void resetVerified(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK) { call.reject("已取消系统验证，密码未改变"); return; }
        run(call, () -> { setPin(pin(call)); call.resolve(state()); });
    }
    @Override protected void handleOnPause() { if (prefs != null && enabled()) pausedAt = System.currentTimeMillis(); }
    @Override protected void handleOnResume() { if (prefs != null && enabled() && pausedAt > 0) { if (System.currentTimeMillis() - pausedAt >= 30_000) locked = true; pausedAt = 0; } }
    @Override protected void handleOnDestroy() { worker.shutdown(); }
}
