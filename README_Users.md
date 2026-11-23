# Quarc Store — User Guide

Quarc Store is where you get every Quarc app, keep them up to date, and sign in to all of
them at once. It's **optional**: every Quarc app still works on its own.

## Before you start

You need **Tailscale** installed and connected on your device (same as for every Quarc
app), and a Quarc account — it's the same username and password you use for Quarc Music,
Notes, Calendar and the others.

## Android

### Install Quarc Store

1. On your phone, open the [latest release](https://github.com/zekicandemiralay/Quarc_Store/releases/latest)
   and download **Quarc-Store-Android.apk**.
2. Open it. If Android asks, allow your browser/file manager to install apps.

### Sign in once, use every app

Open Quarc Store → **Account** → sign in. That's it: every Quarc app on this phone is now
signed in with your account. Open Quarc Music, Notes, … — no login screen.

- If an app was already open, switch back to it and it picks up the login.
- An app's login screen also shows **"Continue as ⟨you⟩"** when the Store is signed in.
- If the Store isn't signed in yet, apps show **"Sign in with Quarc Store"** — it opens the
  Store, and brings you back once you're signed in.

**Signing out of Quarc Store signs you out of every Quarc app on this phone.** Signing out
of a single app only affects that app.

### Install and update apps

- **Apps** tab: every Quarc app. Tap **Install**, **Update** or **Open**.
- The first time, Android asks you to allow Quarc Store to install apps — tap
  *Open settings*, turn on **Allow from this source**, and go back.
- **Updates** tab: everything with a new version, with **Update all**, plus what's new in
  each release.
- After an app has been installed or updated once through the Store, Android 12+ lets the
  Store update it without asking again.

If you already installed an app from GitHub before, the Store can update it as long as it's
the official release. (If Android says the update "conflicts", uninstall that app once and
install it from the Store.)

### Notifications and automatic updates

Account → Settings:

- **Notify me about updates** — checks a few times a day.
- **Install updates automatically** — for apps the Store installed (Android 12+).

### Your devices

Account → **Where you are signed in** lists every phone, computer and browser using your
account (and which apps the Store signed in on each phone). Tap ✕ to sign one out, or
**Sign out everywhere else** if you lost a device.

### "Update required"

Sometimes an old version of an app stops working with the server. Then the Store marks
its update **Required**, and the app itself shows an "Update required" screen — tap
**Update**.

## Windows

### Install Quarc Store

1. Open the [latest release](https://github.com/zekicandemiralay/Quarc_Store/releases/latest) and
   download **Quarc.Store_…_x64-setup.exe**.
2. Run it. Windows may say "Windows protected your PC" because the Quarc apps aren't signed with
   a paid certificate: choose **More info → Run anyway**. It installs for you only, with no
   administrator prompt.

Sign in with your Quarc username and password, or with **Sign in with your phone**.

### Install and update apps

- **Apps** tab: every Quarc app. Press **Install**, **Update** or **Open**. The Store downloads the
  app's installer and runs it for you, so there is nothing to click through.
- **Updates** tab: everything with a new version, with **Update all**. If the app is open, its
  installer closes it first — save your work. The Store looks for new releases whenever you come
  back to its window, and every 30 minutes while it's open.
- **Uninstall** (on an app's page) removes the app but keeps its data.
- The Store updates itself the same way: press **Update** on Quarc Store and it restarts.

### What's different from Android

Each Quarc desktop app keeps its own login — the Store doesn't sign them in. (You can still use
**Sign in with your phone** in each app.) There are no background update notifications.

## Web, macOS, Linux, iPhone

Open **https://quarcnet0.tail84500c.ts.net:4006** in a browser: the same list of apps,
with downloads for every platform and your account settings. In a browser, signing in to
one Quarc app already signs you in to the others.

### Sign in on a computer with your phone

On any Quarc app's login page in a browser or desktop app, choose **Sign in with your
phone**, type your username and tap **Send to my phone**. The page shows a number. Open
Quarc Store on your phone (signed in), type that number, tap **Approve** — the computer is
signed in. If a request pops up that you didn't start, tap **Deny**.

## Troubleshooting

| Problem | Fix |
|---|---|
| An app still shows its login screen | Make sure the app is updated (single sign-on needs a recent version), then switch away from it and back |
| "Sign in with Quarc Store" does nothing | Update Quarc Store |
| Windows: "Install failed" | Check Tailscale and that GitHub is reachable, then try again. |
| Install stuck on "Confirm…" | Look for Android's install dialog, or pull down the notification shade |
| "Couldn't load the app list" | Check that Tailscale is connected |
| Phone sign-in: nothing appears on the phone | Open Quarc Store on the phone (it checks while it's open) and make sure it's signed in to the same account |
