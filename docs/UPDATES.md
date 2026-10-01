# Updates

ArmaHost Desktop keeps itself up to date.

- **Automatic checks:** about 15 seconds after it opens and then every 6 hours, ArmaHost checks GitHub Releases for a newer version. You can turn this off in the sidebar under **Updates**, and **Check now** checks at any time.
- **Background download:** a newer version is downloaded in the background, and its size and SHA-256 checksum are verified against the release before it is offered. Nothing is installed without you.
- **One click to install:** when the update is ready, a banner says **ArmaHost X is ready**:
  - **Restart & update** closes ArmaHost and installs the update. The installer build updates silently in its existing folder and reopens. The portable build starts the new portable file, saved next to your current one, and you can delete the old file afterwards.
  - **What's new** shows the release notes.
  - **Later** hides the banner until the next launch.
- **Your server keeps running** during an update, and ArmaHost reconnects to it when it reopens. Unsaved dashboard edits are lost, and the confirmation says so.
- **Skip this version** stops automatic prompts for that version; **Check now** still offers it.

Windows SmartScreen may warn about the unsigned installer the first time; choose **More info → Run anyway**.
