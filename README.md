Very alpha version of itslearning upload/download system.

It's just working, and pretty hacky (and probably a bit unstable as well)

---

Create a `~/.itslrn` file with your credentials for login directly on itslearning (https://absalon.itslearning.com/) -- NOT the KU login.

```
{ "username":"abc123"
, "password":"direct password for absalon"
}
```

---

You need to install phantomjs (I'm running version 1.9.0), and you should get casperjs by `git submodule init`

---

There are two tings you can do right now (and you need to be in the top folder when executing the script)

1. `./run.sh ta download-essay ESSAY-ID [DOWNLOAD-PATH]` -- will download all files submitted by students
    - **NOTE** you need to have the filter set to *all*, if you want to download all submissions.
    - Currently fails if no submissions can be found.
    - If a student has uploaded a file with the same name twice, you will ONLY get the newest version

2. `./run.sh ta upload-essay ESSAY-ID [DOWNLOAD-PATH]` -- will upload all files you have put in `ESSAY-ID/<STUDENT-ID>/ta_files/`
    - If a file already exists with the same name as one of your upload files, it will be removed.

---

At first I thought it was a nice idea to get around itslearning awful website to run everything though a headless browser, but I'm of a much different view now.
