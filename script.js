/* ==========================================================
   ATTENDANCE REGISTER

   Every subject keeps three counts:
       attended   — lectures you actually turned up to
       conducted  — lectures held so far
       planned    — lectures scheduled for the whole term

   Knowing `planned` is what makes the skip budget real. Without it,
   "you can skip 4" is only true in the abstract; with it, the app can
   say how many of the lectures that actually remain you may miss.

   One rule runs through the whole app:
       something happens -> change state -> saveState() -> render()
   `state` is the only source of truth. No number is ever read back off
   the page in order to calculate with it.
   ========================================================== */


/* ===== 1. STATE ===== */

const STORAGE_KEY = "attendanceTracker_v2";
const DATA_VERSION = 2;
const DEFAULT_THRESHOLD = 0.75;

// Everything that gets saved.
let state = {
  version: DATA_VERSION,
  threshold: DEFAULT_THRESHOLD,
  theme: null,          // null = follow the operating system
  subjects: []          // { id, name, attended, conducted, planned }
};

// View-only settings. These change what we draw, never what we store,
// so they deliberately live outside `state`.
let searchText = "";
let activeFilter = "all";     // "all" | "safe" | "short"
let editingId = null;         // id of the card currently being edited
let confirmDeleteId = null;   // id of the card asking "Delete? Yes / No"
let storageIsAvailable = true;

function byId(id) {
  return document.getElementById(id);
}

const cardListEl = byId("cardList");
const emptyStateEl = byId("emptyState");
const addFormEl = byId("addForm");
const nameInputEl = byId("nameInput");
const attendedInputEl = byId("attendedInput");
const conductedInputEl = byId("conductedInput");
const plannedInputEl = byId("plannedInput");
const addErrorEl = byId("addError");
const searchInputEl = byId("searchInput");
const filterRowEl = byId("filterRow");
const thresholdSelectEl = byId("thresholdSelect");
const themeToggleEl = byId("themeToggle");
const storageWarningEl = byId("storageWarning");
const summaryOverallEl = byId("summaryOverall");
const summarySafeEl = byId("summarySafe");
const summaryShortEl = byId("summaryShort");


/* ===== 2. STORAGE ===== */

function loadState() {
  let rawText = null;

  // Even reading can throw when storage is blocked, so it is guarded too.
  try {
    rawText = localStorage.getItem(STORAGE_KEY);
  } catch (error) {
    storageIsAvailable = false;
    return;
  }

  if (rawText === null) {
    return;                     // first ever visit: keep the defaults
  }

  let saved = null;
  try {
    saved = JSON.parse(rawText);
  } catch (error) {
    return;                     // corrupt data: open empty rather than crash
  }

  // Anything unexpected — not an object, or written by an older version of
  // the app — means we start fresh instead of trying to guess.
  if (saved === null || typeof saved !== "object" || saved.version !== DATA_VERSION) {
    return;
  }

  if (typeof saved.threshold === "number") {
    state.threshold = saved.threshold;
  }
  if (saved.theme === "light" || saved.theme === "dark") {
    state.theme = saved.theme;
  }
  if (!Array.isArray(saved.subjects)) {
    return;
  }

  // Copy the subjects across one at a time, skipping anything malformed.
  for (let i = 0; i < saved.subjects.length; i++) {
    const item = saved.subjects[i];
    if (!item || typeof item.name !== "string") {
      continue;
    }
    if (!Number.isInteger(item.attended) ||
        !Number.isInteger(item.conducted) ||
        !Number.isInteger(item.planned)) {
      continue;
    }
    state.subjects.push({
      id: String(item.id),
      name: item.name,
      attended: item.attended,
      conducted: item.conducted,
      planned: item.planned
    });
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    // Private browsing or a full quota. The app keeps working for this
    // session; we just warn that changes won't survive a reload.
    storageIsAvailable = false;
    storageWarningEl.hidden = false;
  }
}


/* ===== 3. CALCULATIONS =====
   These take numbers and give back numbers. They never look at the page
   and never change state, which is what makes them easy to check. */

// Your standing right now, out of the lectures actually held so far.
// Returns null when nothing has been held, so the UI can show a dash
// instead of NaN or a misleading 0%.
function getPercentage(attended, conducted) {
  if (conducted === 0) {
    return null;
  }
  return (attended / conducted) * 100;
}

function lecturesRemaining(conducted, planned) {
  return Math.max(0, planned - conducted);
}

// To finish the term at the threshold you need T of ALL planned lectures:
//     finalAttended / planned >= T   ->   finalAttended >= T * planned
// Rounded UP, because you cannot attend a fraction of a lecture and
// rounding down would leave you finishing just below the line.
function lecturesYouMustAttend(attended, planned, threshold) {
  const requiredByTheEnd = Math.ceil(threshold * planned);
  return Math.max(0, requiredByTheEnd - attended);
}

// Whatever is left over after the compulsory ones are set aside.
// Plain subtraction of two whole numbers, so no rounding is needed here.
// A negative answer means the threshold can no longer be reached.
function lecturesYouCanSkip(attended, conducted, planned, threshold) {
  return lecturesRemaining(conducted, planned) -
         lecturesYouMustAttend(attended, planned, threshold);
}

function isShort(subject) {
  if (subject.conducted === 0) {
    return false;               // nothing held yet: neither safe nor short
  }
  return subject.attended / subject.conducted < state.threshold;
}

function isSafe(subject) {
  if (subject.conducted === 0) {
    return false;
  }
  return subject.attended / subject.conducted >= state.threshold;
}

function getThresholdPercent() {
  return Math.round(state.threshold * 100);
}

// The sentence under the numbers — the actual point of the app.
function getAdviceText(subject) {
  const percent = getThresholdPercent();

  if (subject.planned === 0) {
    return "Add the term total to see your skip budget";
  }

  const remaining = lecturesRemaining(subject.conducted, subject.planned);
  const mustAttend = lecturesYouMustAttend(subject.attended, subject.planned, state.threshold);
  const canSkip = remaining - mustAttend;

  if (remaining === 0) {
    if (mustAttend > 0) {
      return "Term over — finished below " + percent + "%";
    }
    return "Term over — you finished above " + percent + "%";
  }
  if (canSkip < 0) {
    // Honest rather than a promise the maths can't keep.
    return percent + "% is out of reach even if you attend all " +
           remaining + " left — talk to your faculty advisor";
  }
  if (canSkip === 0) {
    return "Attend all " + remaining + " remaining — no skips left";
  }
  return "You can skip " + canSkip + " more this term";
}


/* ===== 4. RENDERING =====
   These read state and write to the page. They never change state. */

// Small builders that keep the card code below short and readable.
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    // textContent, not innerHTML: a subject named <img src=x onerror=alert(1)>
    // must appear as those literal characters, never run as HTML.
    node.textContent = text;
  }
  return node;
}

function makeButton(label, className, action) {
  const button = el("button", className, label);
  button.type = "button";
  button.dataset.action = action;
  return button;
}

function render() {
  renderSummary();
  renderCards();
}

function renderSummary() {
  let totalAttended = 0;
  let totalConducted = 0;
  let safeCount = 0;
  let shortCount = 0;
  let countedSubjects = 0;

  for (let i = 0; i < state.subjects.length; i++) {
    const subject = state.subjects[i];
    if (subject.conducted === 0) {
      continue;                 // excluded from the overall figure entirely
    }
    countedSubjects = countedSubjects + 1;
    totalAttended = totalAttended + subject.attended;
    totalConducted = totalConducted + subject.conducted;
    if (isShort(subject)) {
      shortCount = shortCount + 1;
    } else {
      safeCount = safeCount + 1;
    }
  }

  // Overall is the sum of attended over the sum of conducted — NOT the
  // average of the per-subject percentages. Those differ whenever subjects
  // have had different numbers of lectures, and only this one is correct.
  const overall = getPercentage(totalAttended, totalConducted);

  summaryOverallEl.textContent = overall === null ? "—" : overall.toFixed(1) + "%";
  summarySafeEl.textContent = safeCount + " of " + countedSubjects;
  summaryShortEl.textContent = String(shortCount);
}

// Applies the search box and the filter chips. View only — the stored list
// of subjects is never altered by filtering.
function getVisibleSubjects() {
  const visible = [];
  const query = searchText.trim().toLowerCase();

  for (let i = 0; i < state.subjects.length; i++) {
    const subject = state.subjects[i];
    if (query !== "" && subject.name.toLowerCase().indexOf(query) === -1) {
      continue;
    }
    if (activeFilter === "safe" && !isSafe(subject)) {
      continue;
    }
    if (activeFilter === "short" && !isShort(subject)) {
      continue;
    }
    visible.push(subject);
  }
  return visible;
}

function renderCards() {
  // Rebuild the whole list every time. With a handful of subjects this is
  // instant, and it means the page can never drift out of sync with state.
  cardListEl.textContent = "";

  if (state.subjects.length === 0) {
    emptyStateEl.textContent = "Add your first subject to start tracking.";
    emptyStateEl.hidden = false;
    return;
  }

  const visible = getVisibleSubjects();
  if (visible.length === 0) {
    emptyStateEl.textContent = "No subjects match this search or filter.";
    emptyStateEl.hidden = false;
    return;
  }

  emptyStateEl.hidden = true;
  for (let i = 0; i < visible.length; i++) {
    if (visible[i].id === editingId) {
      cardListEl.appendChild(buildEditCard(visible[i]));
    } else {
      cardListEl.appendChild(buildCard(visible[i]));
    }
  }
}

// One labelled figure in the three-column strip on a card.
function buildCountBox(label, value, minusAction) {
  const box = el("div", "count-box");
  box.appendChild(el("span", "count-label", label));

  const row = el("div", "count-row");
  row.appendChild(el("span", "count-value num", String(value)));
  if (minusAction !== null) {
    row.appendChild(makeButton("−", "link-button", minusAction));
  }
  box.appendChild(row);
  return box;
}

function buildCard(subject) {
  const card = el("article", "card");
  card.dataset.id = subject.id;

  const short = isShort(subject);
  if (short) {
    card.classList.add("is-short");
  }
  if (subject.conducted === 0) {
    card.classList.add("is-not-started");
  }

  // --- name, plus the stamp on short cards ---
  const nameEl = el("h3", "subject-name", subject.name);
  nameEl.title = subject.name;              // full name for a truncated one
  card.appendChild(nameEl);
  if (short) {
    card.appendChild(el("span", "stamp", "SHORT"));
  }

  // --- the big percentage ---
  const percent = getPercentage(subject.attended, subject.conducted);
  const percentEl = el("p", "percent", percent === null ? "—" : percent.toFixed(1));
  if (percent !== null) {
    percentEl.appendChild(el("span", "percent-sign", "%"));
  }
  card.appendChild(percentEl);

  // --- progress bar (width worked out fresh, never stored) ---
  const bar = el("div", "bar");
  const barFill = el("div", "bar-fill");
  barFill.style.width = (percent === null ? 0 : percent) + "%";
  bar.appendChild(barFill);
  card.appendChild(bar);

  // --- the three counts, each undoable except the term total ---
  const counts = el("div", "counts");
  counts.appendChild(buildCountBox("Attended", subject.attended, "minus-attended"));
  counts.appendChild(buildCountBox("Conducted", subject.conducted, "minus-conducted"));
  // A term total of 0 means it hasn't been set, so show a dash not a zero.
  counts.appendChild(buildCountBox("Term total", subject.planned === 0 ? "—" : subject.planned, null));
  card.appendChild(counts);

  // --- the state in words, so colour is never the only signal ---
  let statusText = "Safe";
  if (subject.conducted === 0) {
    statusText = "Not started";
  } else if (short) {
    statusText = "Short of " + getThresholdPercent() + "%";
  }
  card.appendChild(el("p", "status-word", statusText));

  // --- the payload sentence ---
  card.appendChild(el("p", "advice", getAdviceText(subject)));

  // --- the two big buttons, gone once every planned lecture is recorded ---
  if (!termIsFull(subject)) {
    const actions = el("div", "card-actions");
    actions.appendChild(makeButton("Present", "button button-solid", "present"));
    actions.appendChild(makeButton("Absent", "button button-quiet", "absent"));
    card.appendChild(actions);
  }

  // --- edit / delete, or the inline delete confirmation ---
  if (subject.id === confirmDeleteId) {
    const confirmRow = el("div", "confirm-row");
    confirmRow.appendChild(el("span", null, "Delete this subject?"));
    confirmRow.appendChild(makeButton("Yes", "button button-quiet", "delete-yes"));
    confirmRow.appendChild(makeButton("No", "button button-quiet", "delete-no"));
    card.appendChild(confirmRow);
  } else {
    const minor = el("div", "card-minor");
    minor.appendChild(makeButton("Edit counts", "link-button", "edit"));
    minor.appendChild(el("span", null, "·"));
    minor.appendChild(makeButton("Delete", "link-button", "delete-ask"));
    card.appendChild(minor);
  }

  return card;
}

function buildEditField(labelText, fieldName, value, type) {
  const box = el("div", "edit-field");
  box.appendChild(el("span", "count-label", labelText));

  const input = el("input", type === "number" ? "text-input num" : "text-input");
  input.type = type;
  input.value = String(value);
  input.dataset.field = fieldName;
  input.setAttribute("aria-label", labelText);
  if (type === "number") {
    input.min = "0";
    input.step = "1";
  } else {
    input.maxLength = 60;
  }

  box.appendChild(input);
  return box;
}

function buildEditCard(subject) {
  const card = el("article", "card");
  card.dataset.id = subject.id;

  card.appendChild(buildEditField("Subject name", "name", subject.name, "text"));

  const row = el("div", "edit-row");
  row.appendChild(buildEditField("Attended", "attended", subject.attended, "number"));
  row.appendChild(buildEditField("Conducted", "conducted", subject.conducted, "number"));
  row.appendChild(buildEditField("Term total", "planned", subject.planned, "number"));
  card.appendChild(row);

  card.appendChild(el("p", "edit-hint", "Enter to save, Escape to cancel"));

  const errorEl = el("p", "error-text");
  errorEl.dataset.role = "edit-error";
  card.appendChild(errorEl);

  const actions = el("div", "card-actions");
  actions.appendChild(makeButton("Save", "button button-solid", "edit-save"));
  actions.appendChild(makeButton("Cancel", "button button-quiet", "edit-cancel"));
  card.appendChild(actions);

  return card;
}

function applyTheme() {
  let theme = state.theme;

  // No saved choice yet, so follow whatever the operating system prefers.
  if (theme === null) {
    if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
      theme = "dark";
    } else {
      theme = "light";
    }
  }

  document.documentElement.setAttribute("data-theme", theme);
  themeToggleEl.textContent = theme === "dark" ? "Light mode" : "Dark mode";
}


/* ===== 5. EVENTS =====
   The listeners, and the functions that actually change state. */

function findSubjectById(id) {
  for (let i = 0; i < state.subjects.length; i++) {
    if (state.subjects[i].id === id) {
      return state.subjects[i];
    }
  }
  return null;
}

// Shared by the add form and the inline editor.
// Returns an empty string when the input is fine, otherwise the message.
function getValidationError(name, attended, conducted, planned, idToIgnore) {
  const trimmedName = name.trim();

  if (trimmedName === "") {
    return "Subject name can't be empty";
  }

  for (let i = 0; i < state.subjects.length; i++) {
    const other = state.subjects[i];
    if (other.id !== idToIgnore && other.name.toLowerCase() === trimmedName.toLowerCase()) {
      return "\"" + other.name + "\" already exists";
    }
  }

  // The min and step attributes on the inputs are a convenience, not a
  // guarantee — a user can still type or paste anything, so we check here.
  if (!Number.isInteger(attended) || !Number.isInteger(conducted) || !Number.isInteger(planned)) {
    return "Counts must be whole numbers";
  }
  if (attended < 0 || conducted < 0 || planned < 0) {
    return "Counts can't be negative";
  }
  if (attended > conducted) {
    return "Attended can't be more than conducted";
  }
  // A term total of 0 means "not set yet", which is allowed — the card just
  // prompts for it. Any other value has to cover the lectures already held.
  if (planned > 0 && conducted > planned) {
    return "Term total can't be less than conducted";
  }

  return "";
}

// Turns an input's text into a number. Blank counts as 0; anything that
// isn't a clean number becomes NaN so validation can reject it.
function readNumber(text) {
  if (text.trim() === "") {
    return 0;
  }
  return Number(text);
}

// The id must never be the array index or the name, because both change and
// then you delete the wrong subject. Date.now() alone can repeat if two
// subjects are added inside the same millisecond, so count up until unused.
function makeUniqueId() {
  let candidate = "s" + Date.now();
  let suffix = 1;
  while (findSubjectById(candidate) !== null) {
    candidate = "s" + Date.now() + "-" + suffix;
    suffix = suffix + 1;
  }
  return candidate;
}

// Once every planned lecture has been recorded, the term is full and no
// further one can be logged. A term total of 0 means "not set yet", so
// counting stays open until you set one.
function termIsFull(subject) {
  return subject.planned > 0 && subject.conducted >= subject.planned;
}

function markPresent(id) {
  const subject = findSubjectById(id);
  // Hiding the button is not the same as blocking the action, so the rule
  // is enforced here as well as in the card.
  if (termIsFull(subject)) {
    return;
  }
  subject.attended = subject.attended + 1;
  subject.conducted = subject.conducted + 1;
  saveState();
  render();
}

function markAbsent(id) {
  const subject = findSubjectById(id);
  if (termIsFull(subject)) {
    return;
  }
  subject.conducted = subject.conducted + 1;
  saveState();
  render();
}

function decreaseAttended(id) {
  const subject = findSubjectById(id);
  if (subject.attended > 0) {
    subject.attended = subject.attended - 1;
    saveState();
    render();
  }
}

function decreaseConducted(id) {
  const subject = findSubjectById(id);
  if (subject.conducted > 0) {
    subject.conducted = subject.conducted - 1;
    // Attended can never be greater than conducted, so it follows it down.
    if (subject.attended > subject.conducted) {
      subject.attended = subject.conducted;
    }
    saveState();
    render();
  }
}

function deleteSubject(id) {
  const remaining = [];
  for (let i = 0; i < state.subjects.length; i++) {
    if (state.subjects[i].id !== id) {
      remaining.push(state.subjects[i]);
    }
  }
  state.subjects = remaining;
  confirmDeleteId = null;
  saveState();
  render();
}

function saveEdit(cardEl, id) {
  const subject = findSubjectById(id);
  const nameValue = cardEl.querySelector("[data-field='name']").value;
  const attendedValue = readNumber(cardEl.querySelector("[data-field='attended']").value);
  const conductedValue = readNumber(cardEl.querySelector("[data-field='conducted']").value);
  const plannedValue = readNumber(cardEl.querySelector("[data-field='planned']").value);

  const message = getValidationError(nameValue, attendedValue, conductedValue, plannedValue, id);
  if (message !== "") {
    cardEl.querySelector("[data-role='edit-error']").textContent = message;
    return;
  }

  subject.name = nameValue.trim();
  subject.attended = attendedValue;
  subject.conducted = conductedValue;
  subject.planned = plannedValue;
  editingId = null;
  saveState();
  render();
}

/* One click listener for every card button, instead of one listener per
   button. render() throws the cards away and rebuilds them, so per-button
   listeners would have to be re-attached after every single change — more
   code, and a classic source of buttons that quietly stop working or fire
   twice. The container element survives every render, so this never breaks. */
cardListEl.addEventListener("click", function (event) {
  const button = event.target.closest("button[data-action]");
  if (button === null) {
    return;                     // a click on empty space; nothing to do
  }

  const cardEl = button.closest(".card");
  const id = cardEl.dataset.id;
  const action = button.dataset.action;

  if (action === "present") {
    markPresent(id);
  } else if (action === "absent") {
    markAbsent(id);
  } else if (action === "minus-attended") {
    decreaseAttended(id);
  } else if (action === "minus-conducted") {
    decreaseConducted(id);
  } else if (action === "delete-ask") {
    confirmDeleteId = id;
    render();
  } else if (action === "delete-no") {
    confirmDeleteId = null;
    render();
  } else if (action === "delete-yes") {
    deleteSubject(id);
  } else if (action === "edit") {
    editingId = id;
    confirmDeleteId = null;
    render();
    focusEditName(id);
  } else if (action === "edit-cancel") {
    editingId = null;
    render();
  } else if (action === "edit-save") {
    saveEdit(cardEl, id);
  }
});

function focusEditName(id) {
  const input = cardListEl.querySelector(".card[data-id='" + id + "'] [data-field='name']");
  if (input !== null) {
    input.focus();
    input.select();
  }
}

// Enter saves an inline edit, Escape cancels it. Delegated for the same
// reason as the clicks above.
cardListEl.addEventListener("keydown", function (event) {
  if (editingId === null || (event.key !== "Enter" && event.key !== "Escape")) {
    return;
  }
  const cardEl = event.target.closest(".card");
  if (cardEl === null) {
    return;
  }

  if (event.key === "Enter") {
    event.preventDefault();
    saveEdit(cardEl, cardEl.dataset.id);
  } else {
    editingId = null;
    render();
  }
});

addFormEl.addEventListener("submit", function (event) {
  event.preventDefault();

  const nameValue = nameInputEl.value;
  const attendedValue = readNumber(attendedInputEl.value);
  const conductedValue = readNumber(conductedInputEl.value);
  const plannedValue = readNumber(plannedInputEl.value);

  const message = getValidationError(nameValue, attendedValue, conductedValue, plannedValue, null);
  if (message !== "") {
    addErrorEl.textContent = message;
    nameInputEl.focus();
    return;
  }

  state.subjects.push({
    id: makeUniqueId(),
    name: nameValue.trim(),
    attended: attendedValue,
    conducted: conductedValue,
    planned: plannedValue
  });
  saveState();
  render();

  addErrorEl.textContent = "";
  nameInputEl.value = "";
  attendedInputEl.value = "";
  conductedInputEl.value = "";
  plannedInputEl.value = "";
  nameInputEl.focus();
});

searchInputEl.addEventListener("input", function () {
  searchText = searchInputEl.value;
  render();                     // filtering is view-only; state is untouched
});

filterRowEl.addEventListener("click", function (event) {
  const chip = event.target.closest("button[data-filter]");
  if (chip === null) {
    return;
  }
  activeFilter = chip.dataset.filter;

  const chips = filterRowEl.querySelectorAll("button[data-filter]");
  for (let i = 0; i < chips.length; i++) {
    const isActive = chips[i] === chip;
    chips[i].classList.toggle("is-active", isActive);
    chips[i].setAttribute("aria-pressed", String(isActive));
  }
  render();
});

thresholdSelectEl.addEventListener("change", function () {
  state.threshold = Number(thresholdSelectEl.value);
  saveState();
  render();
});

themeToggleEl.addEventListener("click", function () {
  const current = document.documentElement.getAttribute("data-theme");
  state.theme = current === "dark" ? "light" : "dark";
  saveState();
  applyTheme();
});


/* ===== STARTUP ===== */

loadState();
applyTheme();
thresholdSelectEl.value = state.threshold.toFixed(2);

if (!storageIsAvailable) {
  storageWarningEl.hidden = false;
}

render();

if (state.subjects.length === 0) {
  nameInputEl.focus();
}
