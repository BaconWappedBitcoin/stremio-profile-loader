# Signing key

`strloader.jks` is an **intentionally public**, self-signed key used to sign all
STRLoader builds (local and CI) with one consistent signature.

Why commit it: a sideloaded app can only be *updated* in place if each new APK is
signed with the same key as the installed one. Without a shared key, every CI run
would sign with a throwaway debug key and Android would reject the update with
"App not installed."

This key is **not a secret** — it provides upgrade continuity, nothing more. It
does not protect any user data or grant any access. Credentials (by design):

```
storePassword = strloader
keyAlias       = strloader
keyPassword    = strloader
```

This app is not distributed via Google Play; if it ever were, it would need a
separate, private upload key kept out of the repo.
