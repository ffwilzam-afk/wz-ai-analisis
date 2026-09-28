package com.wzmanagepro.app;

import android.Manifest;
import android.app.Activity;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.webkit.JavascriptInterface;
import android.webkit.JsPromptResult;
import android.webkit.WebView;
import android.webkit.CookieManager;
import android.content.pm.PackageManager;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

import com.google.firebase.messaging.FirebaseMessaging;

public class MainActivity extends Activity {

    private static final String START_URL =
            "https://wz-ai-analisis-rust.vercel.app/";

    private static final String APP_HOST = "wz-ai-analisis-rust.vercel.app";

    private static final int NOTIFICATION_PERMISSION_REQUEST = 1001;

    private static final String PREFS = "wz_permissions";
    private static final String PREF_NOTIFICATION_ASKED = "notification_asked";

    private WebView web;
    private String pendingNotificationType = "";
    private String pendingNotificationReportId = "";
    private boolean pageReady = false;
    private boolean showingOfflinePage = false;
    private static MainActivity activeInstance;

    public class AndroidPrintBridge {
        @JavascriptInterface
        public void print() {
            runOnUiThread(() -> {
                PrintManager printManager = (PrintManager) getSystemService(PRINT_SERVICE);
                if (printManager != null && web != null) {
                    // createPrintDocumentAdapter(String) sudah deprecated sejak API 21;
                    // versi tanpa argumen ini yang dipakai sekarang.
                    printManager.print(
                            "WZ MANAGE PRO",
                            web.createPrintDocumentAdapter(),
                            new PrintAttributes.Builder().build()
                    );
                }
            });
        }
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(android.graphics.Color.rgb(8, 9, 11));
        getWindow().setNavigationBarColor(android.graphics.Color.rgb(8, 9, 11));
        getWindow().getDecorView().setSystemUiVisibility(0);

        web = new WebView(this);
        activeInstance = this;

        handleNotificationIntent(getIntent());

        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setAcceptThirdPartyCookies(web, true);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setSupportZoom(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);

        // WebChromeClient kosong membuat alert()/confirm()/prompt() di dalam halaman
        // memakai implementasi bawaan Chromium, sehingga muncul dialog Android asli
        // yang menampilkan alamat URL. Aplikasi web sudah menggambar dialognya sendiri
        // lewat konfirmasi()/peringatan(), jadi ketiga callback di bawah ditelan di sini
        // (return true = sudah ditangani) dan dialog native tidak akan pernah muncul.
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onJsAlert(WebView view, String url, String message,
                                     android.webkit.JsResult result) {
                if (result != null) {
                    result.cancel();
                }
                return true;
            }

            @Override
            public boolean onJsConfirm(WebView view, String url, String message,
                                       android.webkit.JsResult result) {
                if (result != null) {
                    result.cancel();
                }
                return true;
            }

            @Override
            public boolean onJsPrompt(WebView view, String url, String message,
                                      String defaultValue, JsPromptResult result) {
                if (result != null) {
                    result.cancel();
                }
                return true;
            }
        });

        web.addJavascriptInterface(new AndroidPrintBridge(), "WZAndroid");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                pageReady = false;
                showingOfflinePage = false;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (showingOfflinePage) {
                    return;
                }
                pageReady = true;
                loadFcmTokenIntoWebView();
                handlePendingNotification();
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();

                if (url.startsWith("whatsapp://") || url.startsWith("https://wa.me/")) {
                    try {
                        Intent intent = new Intent(Intent.ACTION_VIEW, android.net.Uri.parse(url));
                        startActivity(intent);
                    } catch (Exception e) {
                        Toast.makeText(
                                MainActivity.this,
                                "WhatsApp tidak terpasang di perangkat.",
                                Toast.LENGTH_SHORT
                        ).show();
                    }
                    return true;
                }

                String host = request.getUrl().getHost();
                if (("http".equalsIgnoreCase(request.getUrl().getScheme())
                        || "https".equalsIgnoreCase(request.getUrl().getScheme()))
                        && !APP_HOST.equalsIgnoreCase(host)) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, request.getUrl()));
                    } catch (Exception ignored) {
                    }
                    return true;
                }

                return false;
            }

            @Override
            public void onReceivedError(
                    WebView view,
                    WebResourceRequest request,
                    WebResourceError error) {

                if (request.isForMainFrame()) {
                    showOfflinePage();
                }
            }
        });

        setContentView(web);

        if (savedInstanceState != null) {
            web.restoreState(savedInstanceState);
        } else {
            pageReady = false;
            web.loadUrl(START_URL);
        }

        registerBackHandler();
        requestNotificationPermission();
        registerFcmToken();
    }

    // targetSdk 36 memakai predictive back sehingga onBackPressed() tidak lagi
    // dipanggil di Android 13+. Daftarkan OnBackInvokedCallback dengan logika
    // yang sama: kembali ke halaman sebelumnya bila masih ada, selain itu keluar.
    private void registerBackHandler() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return;
        }

        try {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT,
                    this::goBackOrExit
            );
        } catch (Exception ignored) {
            // Bila registrasi gagal, onBackPressed() di bawah tetap menjadi cadangan.
        }
    }

    private void goBackOrExit() {
        if (web != null && web.canGoBack()) {
            web.goBack();
        } else {
            finish();
        }
    }

    // Ganti halaman error bawaan WebView (yang menampilkan alamat URL mentah)
    // dengan layar "tidak ada koneksi" milik WZ lengkap dengan tombol coba lagi.
    private void showOfflinePage() {
        if (web == null || showingOfflinePage) {
            return;
        }
        showingOfflinePage = true;
        pageReady = false;

        String html = "<!DOCTYPE html><html lang=\"id\"><head><meta charset=\"utf-8\">"
                + "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
                + "<title>WZ MANAGE PRO</title><style>"
                + "*{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;"
                + "align-items:center;justify-content:center;background:#08090b;color:#f4f5f7;"
                + "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;"
                + "padding:24px;text-align:center}"
                + ".box{max-width:340px}"
                + "h1{font-size:19px;margin:0 0 10px;font-weight:700}"
                + "p{font-size:14px;line-height:1.6;color:#9aa1ad;margin:0 0 24px}"
                + "button{width:100%;padding:14px 20px;border:0;border-radius:12px;"
                + "background:#f4f5f7;color:#08090b;font-size:15px;font-weight:700;cursor:pointer}"
                + "</style></head><body><div class=\"box\">"
                + "<h1>Tidak ada koneksi</h1>"
                + "<p>WZ MANAGE PRO tidak dapat menghubungi server. Periksa koneksi internet "
                + "Anda, lalu coba lagi.</p>"
                + "<button onclick=\"location.href='" + START_URL + "'\">Coba lagi</button>"
                + "</div></body></html>";

        web.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
    }

    private void handleNotificationIntent(Intent intent) {
        if (intent == null) {
            return;
        }

        String type = intent.getStringExtra("notification_type");
        String reportId = intent.getStringExtra("notification_report_id");

        if (type != null) {
            pendingNotificationType = type;
        }

        if (reportId != null) {
            pendingNotificationReportId = reportId;
        }

        handlePendingNotification();
    }

    private void handlePendingNotification() {
        if (web == null || !pageReady || pendingNotificationReportId == null
                || pendingNotificationReportId.isEmpty()) {
            return;
        }

        String safeType = JSONObject.quote(pendingNotificationType == null ? "" : pendingNotificationType);
        String safeReportId = JSONObject.quote(pendingNotificationReportId);

        String js =
                "window.WZNotificationType=" + safeType + ";" +
                "window.WZNotificationReportId=" + safeReportId + ";" +
                "if(typeof window.WZHandleNotification==='function')" +
                "{window.WZHandleNotification(" + safeType + "," + safeReportId + ");}";

        web.evaluateJavascript(js, null);

        pendingNotificationType = "";
        pendingNotificationReportId = "";
    }

    public static void notifyNewReport(String type, String reportId) {
        MainActivity mi = activeInstance;
        if (mi != null) {
            mi.injectNotificationJs(type, reportId);
        }
    }

    private void injectNotificationJs(String type, String reportId) {
        if (web == null) {
            return;
        }

        String safeType = JSONObject.quote(type == null ? "" : type);
        String safeReportId = JSONObject.quote(reportId == null ? "" : reportId);

        String js =
                "window.WZNotificationType=" + safeType + ";" +
                "window.WZNotificationReportId=" + safeReportId + ";" +
                "if(typeof window.WZHandleNotification==='function')" +
                "{window.WZHandleNotification(" + safeType + "," + safeReportId + ");}";

        runOnUiThread(() -> web.evaluateJavascript(js, null));
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleNotificationIntent(intent);
    }

    // Izin notifikasi hanya diminta satu kali. Sebelumnya permintaan dikirim
    // ulang setiap cold start; kalau pengguna menolak, Android diam-diam berhenti
    // menampilkannya, sehinggaPermintaan yang sia-sia tetap berjalan terus.
    // Kalau izin dicabut lewat setelan sistem, tandanya dibersihkan lagi supaya
    // pengguna tetap bisa menyalakannya lewat cara resmi Android.
    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return;
        }

        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED) {
            return;
        }

        if (shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS)) {
            // Pengguna pernah menolak lalu mengubah pikiran, atau mencabut izin
            // lewat setelan. Android tidak akan menampilkan dialog lagi, jadi
            // tandanya dibersihkan supaya permintaan berikutnya tetap dicoba.
            getSharedPreferences(PREFS, MODE_PRIVATE)
                    .edit()
                    .remove(PREF_NOTIFICATION_ASKED)
                    .apply();
        }

        if (getSharedPreferences(PREFS, MODE_PRIVATE)
                .getBoolean(PREF_NOTIFICATION_ASKED, false)) {
            return;
        }

        getSharedPreferences(PREFS, MODE_PRIVATE)
                .edit()
                .putBoolean(PREF_NOTIFICATION_ASKED, true)
                .apply();

        requestPermissions(
                new String[]{Manifest.permission.POST_NOTIFICATIONS},
                NOTIFICATION_PERMISSION_REQUEST
        );
    }

    private void registerFcmToken() {
        FirebaseMessaging.getInstance()
                .getToken()
                .addOnCompleteListener(task -> {
                    if (!task.isSuccessful()) {
                        return;
                    }

                    String token = task.getResult();

                    if (token != null && !token.isEmpty()) {
                        getSharedPreferences("wz_fcm", MODE_PRIVATE)
                                .edit()
                                .putString("fcm_token", token)
                                .apply();

                        loadFcmTokenIntoWebView();
                    }
                });
    }

    private void loadFcmTokenIntoWebView() {
        if (web == null) {
            return;
        }

        String token = getSharedPreferences("wz_fcm", MODE_PRIVATE)
                .getString("fcm_token", "");

        if (token == null || token.isEmpty()) {
            return;
        }

        String safeToken = token
                .replace("\\", "\\\\")
                .replace("'", "\\'");

        String js =
                "window.WZNativeFcmToken='" + safeToken + "';" +
                "if(window.WZOnlineFcm&&typeof window.WZOnlineFcm.sync==='function')" +
                "{window.WZOnlineFcm.sync();}";

        web.evaluateJavascript(js, null);

        web.postDelayed(() -> web.evaluateJavascript(js, null), 1500);
        web.postDelayed(() -> web.evaluateJavascript(js, null), 4000);
        web.postDelayed(() -> web.evaluateJavascript(js, null), 8000);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        web.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    protected void onDestroy() {
        if (activeInstance == this) {
            activeInstance = null;
        }
        super.onDestroy();
    }

    // Cadangan untuk Android 12 ke bawah. Di Android 13+ logika yang sama
    // dipindahkan ke OnBackInvokedCallback pada registerBackHandler().
    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        goBackOrExit();
    }
}
