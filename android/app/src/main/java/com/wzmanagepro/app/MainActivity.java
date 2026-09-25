package com.wzmanagepro.app;

import android.Manifest;
import android.app.Activity;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.webkit.JavascriptInterface;
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

    private static final int NOTIFICATION_PERMISSION_REQUEST = 1001;

    private WebView web;
    private String pendingNotificationType = "";
    private String pendingNotificationReportId = "";
    private boolean pageReady = false;
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

        web.setWebChromeClient(new WebChromeClient());
        web.addJavascriptInterface(new AndroidPrintBridge(), "WZAndroid");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                pageReady = false;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
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
                        && !"wz-ai-analisis-rust.vercel.app".equalsIgnoreCase(host)) {
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
                    Toast.makeText(
                            MainActivity.this,
                            "WZ MANAGE PRO tidak dapat terhubung ke server.",
                            Toast.LENGTH_LONG
                    ).show();
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

        requestNotificationPermission();
        registerFcmToken();
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

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {

                requestPermissions(
                        new String[]{Manifest.permission.POST_NOTIFICATIONS},
                        NOTIFICATION_PERMISSION_REQUEST
                );
            }
        }
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

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
