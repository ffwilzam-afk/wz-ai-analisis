# Aturan ProGuard / R8 untuk build rilis WZ MANAGE PRO.
#
# Release memakai minifyEnabled true + shrinkResources true, jadi semua aturan
# di bawah wajib. R8 sudah membawa aturan consumer dari Firebase, WebView, dan
# AndroidX; yang ditulis di sini hanya bagian yang dipanggil lewat JavaScript.

# MainActivity dirujuk dari AndroidManifest ("android:name=.MainActivity") dan
# instantiation-nya hanya satu, jadi aman untuk disimpan utuh. Method statis
# notifyNewReport() dipanggil dari WzFirebaseMessagingService.
-keep class com.wzmanagepro.app.MainActivity { *; }
-keepnames class com.wzmanagepro.app.MainActivity

# Jembatan cetak struk dipanggil dari halaman web lewat
# window.WZAndroid.print(). Tanpa aturan ini, R8 bisa menghapus method print()
# karena tidak terlihat dipanggil dari kode Java.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class com.wzmanagepro.app.MainActivity$AndroidPrintBridge { *; }

# WebViewClient dan WebChromeClient dibuat di dalam MainActivity, tetapi method
# override-nya dipanggil framework Android memakai nama aslinya.
-keep class com.wzmanagepro.app.MainActivity$* { *; }

-keep class com.wzmanagepro.app.WzFirebaseMessagingService { *; }
-keepnames class com.wzmanagepro.app.WzFirebaseMessagingService

# Jangan menggagalkan build karena warning dari library pihak ketiga.
-dontwarn javax.annotation.**
