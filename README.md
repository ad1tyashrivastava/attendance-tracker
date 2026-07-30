# Attendance Register

> Not a form that stores numbers — a tool that answers the only question a student actually has: *can I skip tomorrow's lecture?*

Every subject keeps **three** counts, not two:

| Count | Meaning |
|---|---|
| **Attended** | lectures you actually turned up to |
| **Conducted** | lectures held so far |
| **Term total** | lectures scheduled for the whole term |

That third number is what makes the answer real. Without it, "you can skip 4 more" is true in the abstract but says nothing about whether four more lectures even exist. With it, the skip budget is finite and countable.

Plain HTML, CSS and JavaScript. No frameworks, no npm, no build step.

**Live link:** `https://<ad1tyashrivastava>.github.io/attendance-tracker/`

## Design direction: muster roll

The paper attendance register, digitised. Ruled grid, navy ink, one red rubber stamp.

- Faint horizontal rules across the page, drawn with a CSS `repeating-linear-gradient` — no image file.
- **Fraunces** for the title and the big percentage, **Inter Tight** for everything else, **JetBrains Mono** with `tabular-nums` for every number so the digits don't jitter when a count changes.
- A rotated red **SHORT** stamp on every card below the threshold.

Colour never carries meaning on its own. Any subject that is short gets the stamp *and* the words "Short of 75%" *and* a red left border — take a grayscale screenshot and you can still tell which subjects are in trouble.

---

## Features

**Core**

- Add a subject, with optional starting counts. Blank names and case-insensitive duplicates are rejected with an inline message. A term total of 0 means "not set yet" — the card prompts for it instead of blocking you.
- Delete, with an inline "Delete this subject? Yes / No" on the card — no `window.confirm`.
- `Present` (attended +1, conducted +1) and `Absent` (conducted +1), plus a small `−` beside each to undo a mistake. Attended can never exceed conducted; nothing goes below 0. If extra lectures get scheduled past the term total, the term total rises to match rather than the button going dead.
- Percentage to one decimal. When nothing has been conducted it shows `—`, never `NaN` and never `0%`.
- Cards below the threshold get the stamp, the word and the red border, and are counted in the summary strip.
- Saves to `localStorage` after every change; a reload restores exactly.
- Responsive with no horizontal scrollbar at 320px, 375px, 768px or 1280px.

**Bonus**

1. **Skip / recovery counter** — the reason the app exists. Counted against the lectures that actually remain in the term, so the answer is finite: *"you can skip 4 more this term"*, or *"attend all 12 remaining — no skips left"*, or an honest *"80% is out of reach even if you attend all 5 left"*.
2. Progress bar — two nested `<div>`s, width set as a percentage string. No chart library.
3. Dark / light mode — follows the OS on first load via `prefers-color-scheme`, then remembers your manual choice.
4. Search by name plus All / Safe / Short filter chips. Both are view-only; they never touch the stored data.
5. Inline edit on the card — name and all three counts. Enter saves, Escape cancels, same validation as adding.
6. Adjustable threshold (65 / 70 / 75 / 80 / 85), persisted.

---

## The maths

Let `a` = attended, `c` = conducted so far, `p` = term total, `T` = threshold as a decimal.

### Your percentage right now

`a / c`, out of the lectures actually held. When `c` is 0 the app shows `—`, never `NaN` and never `0%`.

### How many lectures you must still attend

At the end of the term you will have sat through `p` lectures in total, and you need `T` of them:

```
finalAttended / p  >=  T
finalAttended      >=  T * p
```

You cannot attend a fraction of a lecture, so the real requirement is `ceil(T * p)`. Subtract the ones you already have:

```
mustAttend = max(0, ceil(T * p) − a)
```

### How many you can skip

Count what is left, then set aside the compulsory ones:

```
remaining = p − c
canSkip   = remaining − mustAttend
```

**Worked example** — Calculus at 80%, 5 attended, 10 conducted, 45 in the term:

```
mustAttend = ceil(0.80 × 45) − 5  =  36 − 5  =  31
remaining  = 45 − 10              =  35
canSkip    = 35 − 31              =  4          →  "You can skip 4 more this term"
```

Check it: skip 4 of the remaining 35 and you attend 31, finishing on `5 + 31 = 36` out of 45, which is exactly 80%. Skip a fifth and you land on 35/45 = 77.8%. ✓

### One rounding decision, and it rounds against you

There is exactly one place this model rounds: `Math.ceil(T * p)`. **Ceil, because rounding the requirement down would let you finish just below the line.** At 80% of 45 the exact figure is 36.0, but at 75% of 45 it is 33.75 — you cannot attend 33.75 lectures, so the honest requirement is 34.

`canSkip` needs no rounding at all: it's one whole number subtracted from another. That's a side benefit of tracking the term total — the old two-number model needed a `ceil` *and* a `floor` in opposite directions, which is easy to get backwards.

### When the threshold is out of reach

If `canSkip` comes out negative, attending every single remaining lecture still isn't enough. The card says so plainly and suggests talking to a faculty advisor, rather than printing a number that can't happen.

### Overall percentage

```js
const overall = (sumOfAttended / sumOfConducted) * 100;   // right
const wrong = averageOfEachSubjectPercentage;             // wrong
```

Two subjects — 1/1 (100%) and 0/99 (0%). The average of the percentages is 50%. The real figure is 1/100 = 1%. Subjects with no lectures held yet are excluded from the calculation entirely.

---

## How the code is organised

Three files plus this README. `script.js` is split into five labelled blocks:

1. **State** — one object holding all the truth.
2. **Storage** — `loadState()` and `saveState()`, both wrapped in `try / catch`.
3. **Calculations** — take numbers, return numbers, never touch the page.
4. **Rendering** — read state, write to the page, never change state.
5. **Events** — the listeners, and the functions that change state.

The flow is always:

```
something happens  →  change state  →  saveState()  →  render()
```

`render()` rebuilds the whole card list from `state`, so the page can never drift out of sync with the data. Nothing is ever read back off the page in order to calculate with it.

**One delegated click listener** sits on the card container rather than one listener per button. Because `render()` throws the cards away and rebuilds them, per-button listeners would need re-attaching after every change — more code, and a classic source of buttons that silently stop working or fire twice. The container survives every render.

**Only counts are stored.** Percentage, progress-bar width and skip budget are worked out fresh at render time. Saving a derived value means two copies of the same fact that can disagree.

**Safety.** All user text reaches the page through `textContent`, never `innerHTML`. Add a subject called `<img src=x onerror=alert(1)>` and it appears on the card as those literal characters, with no popup.

**Failure modes.** Corrupt JSON, a version mismatch, or `localStorage` being unavailable all open the app empty and working rather than showing a blank page. If `setItem` throws (private browsing, full quota) the app keeps working for the session and shows the line *"Changes won't be saved in this browser"*.

---

## Accessibility

- Everything is reachable by Tab; Enter submits the add form; Escape cancels an inline edit.
- Visible `:focus-visible` ring — `outline: none` is never used without a replacement.
- `aria-live="polite"` on the summary strip so a screen reader announces the change.
- `prefers-reduced-motion: reduce` disables transitions.
- Long subject names get a CSS ellipsis with the full name in the `title` attribute.

---

## Run it locally

Clone or download the folder and double-click `index.html`. That's it — plain `<script src="script.js">` with no ES modules, so it works straight off the `file://` protocol.

For live reloading while editing: VS Code → install the **Live Server** extension → right-click `index.html` → *Open with Live Server*.

---

## Deploy to GitHub Pages

1. Create a **public** repo called `attendance-tracker`, push to `main`.
2. Settings → Pages → Source: *Deploy from a branch* → `main` / `/ (root)` → Save.
3. Every path in the project is relative (`href="style.css"`, not `href="/style.css"`) — a leading slash is the classic Pages 404 that looks fine locally.

### Commit sequence

```bash
cd ~/Desktop/webdevcc
git init
git branch -M main

git add .gitignore index.html
git commit -m "HTML structure and page layout"

git add style.css
git commit -m "Muster roll styling: ruled paper, cards, SHORT stamp"

git add script.js
git commit -m "Attendance logic: state, storage, calculations, rendering"

git add README.md
git commit -m "README with skip-calculator derivation"

git remote add origin https://github.com/ad1tyashrivastava/attendance-tracker.git
git push -u origin main
```

Four honest commits, each touching real files. Every change after this point gets its own commit, which is what builds the history a reviewer actually wants to read.

---

## What I'd add next

**A dated log behind each count, instead of just a running number.** Right now the app knows you attended 24 of 64 lectures but not *which* ones, so it can't answer the follow-up question everyone asks next: *am I getting worse?* Storing `{ date, present }` per lecture would let the card show a trend — "you were at 82% in September and 61% now" — which is the difference between a subject that has a problem and a subject that had one. It also makes the skip budget smarter, because a run of three missed Mondays is a pattern worth flagging, and a single missed week isn't.

It's the right next feature because it needs no new UI concepts — the same Present and Absent buttons already produce the data, they just throw the timestamp away.
