# Markdown to Word

A free Windows desktop app that converts Markdown to a Word (`.docx`) or PDF file, with a live preview as you type.

- **Paste markdown** into the editor, or **upload a `.md` file**
- See a live, rendered **preview** side-by-side
- **Export to Word (.docx)** — opens in Word 2007 and later
- **Export to PDF**
- Everything runs locally on your machine — nothing is uploaded anywhere

## Download

Grab the latest installer from the [Releases page](../../releases) — no need to install Node.js or anything else. Download `Markdown to Word Setup <version>.exe`, run it, and launch the app.

(A portable `.exe` that needs no installation is also attached to each release.)

## Running from source

```bash
npm install
npm start
```

## Building the Windows installer yourself

```bash
npm install
npm run dist
```

The installer and portable `.exe` will be created in the `dist/` folder.

## How releases are published

This repo's [GitHub Actions workflow](.github/workflows/build.yml) builds the Windows installer automatically on a real Windows runner. To publish a new release:

```bash
git tag v1.0.0
git push origin v1.0.0
```

That triggers a build and automatically creates a GitHub Release with the installer attached — anyone can then download it from the Releases page.

## Tech

Built with [Electron](https://www.electronjs.org/), [markdown-it](https://github.com/markdown-it/markdown-it), and [html-to-docx](https://github.com/privateOmega/html-to-docx). PDF export uses Chromium's built-in PDF engine.

## License

MIT — see [LICENSE](LICENSE).
