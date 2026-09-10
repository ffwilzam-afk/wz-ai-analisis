# WZ MANAGE PRO — Play Store build

## 1. Set the final HTTPS website URL
Edit `app/src/main/java/com/wzmanagepro/app/MainActivity.java` and replace `START_URL` with the final live WZ MANAGE PRO URL.

Do not publish while the URL returns 404/unreachable.

## 2. Build AAB
Ensure the Android SDK is available, then run from `android/`:

```bash
export ANDROID_HOME=/path/to/android-sdk
export ANDROID_SDK_ROOT="$ANDROID_HOME"
./gradlew clean bundleRelease
```

The repository includes the Gradle wrapper, so a system Gradle installation is not required.

Output:
`app/build/outputs/bundle/release/app-release.aab`

## 3. Upload signing key
For a new Play app, generate an upload keystore and configure Gradle signing locally. Never commit the keystore or passwords to GitHub. The local `keystore/` directory is ignored by Git.

## 4. Play requirements
This project targets Android API 36. New personal developer accounts created after 13 Nov 2023 may need a closed test with at least 12 opted-in testers continuously for 14 days before production access.
