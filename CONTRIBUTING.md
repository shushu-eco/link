# Working on Link with us

Thank you for looking. Link is made by one person, so answers are not instant, but every issue and
pull request is read.

## Ways to help

- **Say what broke.** Open an issue with the "Something does not work" form. The version, what you did
  and what happened are enough.
- **Say what is missing.** The "An idea" form. One idea to an issue.
- **Take a small task.** Issues marked [`good first issue`](https://github.com/shushu-eco/link/labels/good%20first%20issue)
  are small and have a clear end. Say in the issue that you are taking it, so two people do not do the same work.
- **Try it and tell us.** A sentence in [Discord](https://discord.gg/N3jdn6WPJd) about how your first
  recording went is worth a lot.

## The three parts

| Part | Folder | To run it |
|---|---|---|
| **Link Lite Recorder**, the browser extension | `extension/` | No build step. Load the folder at `chrome://extensions` (Developer mode, **Load unpacked**), change a file, press reload there. |
| **Link TURBO**, the Windows program | `tools/reels/` | `powershell -ExecutionPolicy Bypass -File setup.ps1`, then the **Link** icon. What it needs is in the README under "What you need". |
| **linkturbo.app**, the website | `site/`, `legal/` | `node site/build.js` builds `site/out`; `node site/serve.js` shows it at `localhost:8791`. |

## Before a pull request

- **The extension:** `node store/freetest.js` tries it in a browser nobody sees. It should end with every check passed.
- **Link's window:** the two scripts in `tools/reels/test/` (`make_copy.py` makes a copy of the library,
  `window_test.js` drives the window through it).
- **Keep it small.** One change to a pull request, and say in a sentence what it does and how you tried it.
- **Write as the code around it is written:** plain names, comments that say why, no new dependency
  without a word about it first.
- **Nothing that phones home.** Link uploads nothing and has no analytics. A change that sends anything
  off the user's computer needs a very good reason and the user's own choice.

## How a pull request lands

Link is developed in a private copy and published here from it (`tools/package/publish.ps1`), one commit
at a time. So a pull request is not merged with the button: it is taken over by hand, and may land as
part of a larger commit. You are named in that commit's message, and the pull request is closed with a
link to it.

## Licence

Link is under the [GNU General Public License, version 3](LICENSE). By sending a change you agree that
it is published under the same licence.

## Being decent

See the [code of conduct](CODE_OF_CONDUCT.md). In short: be kind, stay on the subject, and record or
post only streams you have the right to use.
