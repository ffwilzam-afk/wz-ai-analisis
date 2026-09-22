-keep class com.wzmanagepro.app.MainActivity {
    public static void notifyNewReport(java.lang.String, java.lang.String);
    private void injectNotificationJs(java.lang.String, java.lang.String);
    private static com.wzmanagepro.app.MainActivity activeInstance;
}

-keep class com.wzmanagepro.app.WzFirebaseMessagingService {
    *;
}
