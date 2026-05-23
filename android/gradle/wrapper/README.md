# Gradle Wrapper

`gradle-wrapper.jar` is intentionally **not** committed (see
`android/.gitignore`). Binary artefacts inside the source tree muddy
diff review and slow down clones; the Gradle team's own guidance for
new projects since 8.4 is to regenerate the wrapper locally on first
checkout.

## First-time setup

Once you have a JDK 17+ and a system `gradle` 8.x on `$PATH`:

```bash
cd android
gradle wrapper --gradle-version 8.7
```

That populates this directory with `gradle-wrapper.jar` (matching
`gradle-wrapper.properties` here) and writes the `gradlew` /
`gradlew.bat` launchers at `android/`. After that, day-to-day Gradle
work uses `./gradlew` and the system `gradle` is no longer required.

## CI

GitHub Actions installs Gradle directly via
[`gradle/actions/setup-gradle@v3`](https://github.com/gradle/actions/tree/main/setup-gradle)
and runs `gradle` not `./gradlew`. The action pins the version from
this directory's `gradle-wrapper.properties` so the local + CI Gradle
versions stay in lockstep.
