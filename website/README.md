# Hudson Mazzanti — personal website

A one-page site in plain HTML and CSS. No build step: what's in this folder is exactly what visitors get.

## Which file do I edit?

| I want to change… | Edit this |
|---|---|
| Any words (jobs, bullets, education, skills, contact) | `index.html` |
| Colors, fonts, spacing | `styles.css` (colors are at the very top) |
| The downloadable resume | replace `assets/resume.pdf` |
| My photo | add `assets/headshot.jpg` (see below) |

In `index.html`, each section starts with a marker like `<!-- ===== EXPERIENCE ===== -->`, so you can search for the section you want.

## How to edit on GitHub (no software needed)

1. Open the file on github.com and click the ✏️ pencil icon.
2. Change the words between the tags (e.g. `<li>Your bullet here</li>`). Leave the `<` `>` tags themselves alone.
3. Click **Commit changes**. The live site updates in about a minute.

To add a bullet, copy an existing `<li>…</li>` line and change its text.

## Still to do

- **LinkedIn:** in `index.html`, search for `LINKEDIN` and replace the `#` in `href="#"` on the line below it with your full LinkedIn address.
- **Resume PDF:** upload a PDF **without your phone number** into the `assets` folder, named exactly `resume.pdf` (on GitHub: open `assets` → **Add file → Upload files**). Until then, the download buttons won't work.
- **Headshot:** upload a square photo (at least 800×800) into `assets` named `headshot.jpg`. Then in `index.html`, search for `HEADSHOT`, delete the line `<div class="headshot-placeholder" …>HM</div>`, and remove the `<!--` and `-->` around the `<img …>` line.

## Previewing on your computer

Double-click `index.html` to open it in your browser.
