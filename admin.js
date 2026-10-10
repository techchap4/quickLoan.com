// =====================================================
//  QuickLoan - admin.js
//  Uses SUPABASE_URL, SUPABASE_KEY, ANNUAL_INTEREST_RATE
//  and CURRENCY from config.js
// =====================================================

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const $ = (id) => document.getElementById(id);
const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

function money(n) {
  return CURRENCY + Number(n).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function showMessage(el, text, type) {
  el.textContent = text;
  el.className = "message " + (type || "");
}

function monthlyPayment(principal, annualRate, months) {
  const r = annualRate / 100 / 12;
  if (r === 0) return principal / months;
  return (principal * r) / (1 - Math.pow(1 + r, -months));
}

let allApplications = [];
let allMessages = [];
let currentFilter = "all";     // all | pending | approved | rejected
let currentMsgFilter = "all";  // all | unread | read


// =====================================================
//  LOGIN / LOGOUT / FORGOT PASSWORD
// =====================================================

async function login() {
  const email = $("authEmail").value.trim();
  const password = $("authPassword").value;

  if (!email || !password) {
    return showMessage($("authMessage"), "Enter your email and password.", "error");
  }

  $("loginBtn").disabled = true;
  showMessage($("authMessage"), "Logging in...", "");
  const { error } = await db.auth.signInWithPassword({ email, password });
  $("loginBtn").disabled = false;

  if (error) {
    const unverified = error.code === "email_not_confirmed" || /not confirmed/i.test(error.message);
    showMessage($("authMessage"),
      unverified ? "This email is not verified yet. Verify it on the main site first." : error.message,
      "error");
  }
  // On success, onAuthStateChange (bottom of file) takes over.
}

$("loginBtn").addEventListener("click", login);
$("authPassword").addEventListener("keydown", (e) => { if (e.key === "Enter") login(); });

$("logoutBtn").addEventListener("click", async () => {
  await db.auth.signOut();
});

// Sends the reset link to the email typed in the box.
$("forgotBtn").addEventListener("click", async () => {
  const email = $("authEmail").value.trim();
  const msg = $("authMessage");

  if (!isEmail(email)) {
    return showMessage(msg, "Type your admin email above first, then click \"Forgot your password?\".", "error");
  }

  showMessage(msg, "Sending...", "");
  const redirectTo = new URL("reset.html", window.location.href).href;
  const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo });

  if (error) return showMessage(msg, error.message, "error");
  showMessage(msg, "If an account exists for that email, a reset link is on its way.", "success");
});


// =====================================================
//  CHECK ADMIN + LOAD DATA
// =====================================================

// The database only returns a row here if YOU are listed in the admins table.
async function isAdmin() {
  const { data, error } = await db.from("admins").select("user_id").maybeSingle();
  return !error && !!data;
}

async function startAdmin() {
  if (!(await isAdmin())) {
    $("deniedView").hidden = false;
    $("adminView").hidden = true;
    return;
  }
  $("deniedView").hidden = true;
  $("adminView").hidden = false;
  loadAll();
  loadMessages();
}

async function loadAll() {
  showMessage($("adminMessage"), "Loading...", "");

  const { data, error } = await db
    .from("loan_applications")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return showMessage($("adminMessage"), "Could not load: " + error.message, "error");
  }

  allApplications = data;
  showMessage($("adminMessage"), "", "");
  render();
}

async function loadMessages() {
  const { data, error } = await db
    .from("contact_messages")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return showMessage($("adminMessage"),
      "Could not load messages: " + error.message + " (Did you run supabase-setup.sql?)", "error");
  }

  allMessages = data;
  renderMessages();
}


// =====================================================
//  TABS
// =====================================================

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    const name = tab.dataset.tab;
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
    $("tabApplications").hidden = name !== "applications";
    $("tabMessages").hidden = name !== "messages";
    showMessage($("adminMessage"), "", "");
  });
});


// =====================================================
//  APPLICATIONS TABLE
// =====================================================

function render() {
  const count = (s) => allApplications.filter((a) => a.status === s).length;
  $("countAll").textContent = allApplications.length;
  $("countPending").textContent = count("pending");
  $("countApproved").textContent = count("approved");
  $("countRejected").textContent = count("rejected");

  const q = $("searchBox").value.trim().toLowerCase();
  const rows = allApplications.filter((a) => {
    if (currentFilter !== "all" && a.status !== currentFilter) return false;
    if (!q) return true;
    return (a.full_name || "").toLowerCase().includes(q) ||
           (a.phone || "").toLowerCase().includes(q);
  });

  const body = $("adminBody");
  body.innerHTML = "";
  $("adminEmpty").hidden = rows.length > 0;

  rows.forEach((row) => {
    const tr = document.createElement("tr");

    addCell(tr, new Date(row.created_at).toLocaleDateString());
    addCell(tr, row.full_name);
    addCell(tr, row.phone);
    addCell(tr, money(row.amount));
    addCell(tr, String(row.term_months));
    addCell(tr, money(monthlyPayment(row.amount, ANNUAL_INTEREST_RATE, row.term_months)));
    addCell(tr, row.purpose || "-");

    const statusTd = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = "badge " + row.status;
    badge.textContent = row.status;
    statusTd.appendChild(badge);
    tr.appendChild(statusTd);

    const actionTd = document.createElement("td");
    actionTd.className = "actions";
    if (row.status === "pending") {
      actionTd.appendChild(actionButton("Approve", "btn-approve", () => setStatus(row.id, "approved", actionTd)));
      actionTd.appendChild(actionButton("Reject", "btn-reject", () => {
        if (confirm("Reject the application from " + row.full_name + "?")) setStatus(row.id, "rejected", actionTd);
      }));
    } else {
      actionTd.appendChild(actionButton("Undo", "btn-outline", () => setStatus(row.id, "pending", actionTd)));
    }
    actionTd.appendChild(actionButton("Delete", "btn-outline", () => {
      if (confirm("Permanently delete the application from " + row.full_name + "? This cannot be undone.")) {
        deleteApplication(row.id, actionTd);
      }
    }));
    tr.appendChild(actionTd);

    body.appendChild(tr);
  });
}

function addCell(tr, text) {
  const td = document.createElement("td");
  td.textContent = text;   // textContent keeps user text safe
  tr.appendChild(td);
}

function actionButton(label, extraClass, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "btn btn-small " + extraClass;
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

function lockButtons(container, locked) {
  container.querySelectorAll("button").forEach((b) => { b.disabled = locked; });
}


// =====================================================
//  APPROVE / REJECT / DELETE
// =====================================================

async function setStatus(id, newStatus, container) {
  lockButtons(container, true);

  // .select() returns the changed row, so we can tell if it really happened
  // (security rules can silently block an update).
  const { data, error } = await db
    .from("loan_applications")
    .update({ status: newStatus })
    .eq("id", id)
    .select();

  if (error) {
    lockButtons(container, false);
    return showMessage($("adminMessage"), "Could not update: " + error.message, "error");
  }
  if (!data || data.length === 0) {
    lockButtons(container, false);
    return showMessage($("adminMessage"),
      "Update was blocked. Did you run supabase-setup.sql and add yourself as admin?", "error");
  }

  const item = allApplications.find((a) => a.id === id);
  if (item) item.status = data[0].status;
  showMessage($("adminMessage"), "Application marked as " + newStatus + ".", "success");
  render();
}

async function deleteApplication(id, container) {
  lockButtons(container, true);
  const { data, error } = await db.from("loan_applications").delete().eq("id", id).select();

  if (error || !data || data.length === 0) {
    lockButtons(container, false);
    return showMessage($("adminMessage"),
      "Could not delete: " + (error ? error.message : "blocked by security rules."), "error");
  }

  allApplications = allApplications.filter((a) => a.id !== id);
  showMessage($("adminMessage"), "Application deleted.", "success");
  render();
}


// =====================================================
//  MESSAGES TABLE
// =====================================================

function renderMessages() {
  const unread = allMessages.filter((m) => !m.is_read).length;
  $("unreadCount").textContent = unread;
  $("unreadCount").hidden = unread === 0;

  const rows = allMessages.filter((m) => {
    if (currentMsgFilter === "unread") return !m.is_read;
    if (currentMsgFilter === "read") return m.is_read;
    return true;
  });

  const body = $("msgBody");
  body.innerHTML = "";
  $("msgEmpty").hidden = rows.length > 0;

  rows.forEach((m) => {
    const tr = document.createElement("tr");
    if (!m.is_read) tr.className = "msg-unread";

    addCell(tr, new Date(m.created_at).toLocaleString());
    addCell(tr, m.name);
    addCell(tr, m.email);

    const msgTd = document.createElement("td");
    msgTd.className = "msg-cell";
    msgTd.textContent = m.message;
    tr.appendChild(msgTd);

    const actionTd = document.createElement("td");
    actionTd.className = "actions";

    const reply = document.createElement("a");
    reply.className = "btn btn-small";
    reply.textContent = "Reply";
    reply.href = "mailto:" + encodeURIComponent(m.email).replace("%40", "@") +
                 "?subject=" + encodeURIComponent("Re: your message to QuickLoan");
    actionTd.appendChild(reply);

    actionTd.appendChild(actionButton(m.is_read ? "Mark unread" : "Mark read", "btn-outline",
      () => setRead(m.id, !m.is_read, actionTd)));
    actionTd.appendChild(actionButton("Delete", "btn-outline", () => {
      if (confirm("Delete this message from " + m.name + "?")) deleteMessage(m.id, actionTd);
    }));
    tr.appendChild(actionTd);

    body.appendChild(tr);
  });
}

async function setRead(id, isRead, container) {
  lockButtons(container, true);
  const { data, error } = await db.from("contact_messages").update({ is_read: isRead }).eq("id", id).select();

  if (error || !data || data.length === 0) {
    lockButtons(container, false);
    return showMessage($("adminMessage"),
      "Could not update message: " + (error ? error.message : "blocked by security rules."), "error");
  }
  const item = allMessages.find((m) => m.id === id);
  if (item) item.is_read = data[0].is_read;
  renderMessages();
}

async function deleteMessage(id, container) {
  lockButtons(container, true);
  const { data, error } = await db.from("contact_messages").delete().eq("id", id).select();

  if (error || !data || data.length === 0) {
    lockButtons(container, false);
    return showMessage($("adminMessage"),
      "Could not delete message: " + (error ? error.message : "blocked by security rules."), "error");
  }
  allMessages = allMessages.filter((m) => m.id !== id);
  renderMessages();
}


// =====================================================
//  FILTERS, SEARCH, REFRESH
// =====================================================

$("filters").addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  currentFilter = chip.dataset.filter;
  document.querySelectorAll("#filters .chip").forEach((c) => c.classList.toggle("active", c === chip));
  render();
});

$("msgFilters").addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  currentMsgFilter = chip.dataset.mfilter;
  document.querySelectorAll("#msgFilters .chip").forEach((c) => c.classList.toggle("active", c === chip));
  renderMessages();
});

$("searchBox").addEventListener("input", render);
$("refreshBtn").addEventListener("click", loadAll);
$("refreshMsgBtn").addEventListener("click", loadMessages);


// =====================================================
//  REACT TO LOGIN STATE
// =====================================================

db.auth.onAuthStateChange((event, session) => {
  const loggedIn = !!session;

  $("loggedOutView").hidden = loggedIn;
  $("userBox").hidden = !loggedIn;
  $("userEmail").textContent = loggedIn ? session.user.email : "";

  if (loggedIn) {
    setTimeout(startAdmin, 0);
  } else {
    $("adminView").hidden = true;
    $("deniedView").hidden = true;
    $("adminBody").innerHTML = "";
    $("msgBody").innerHTML = "";
    $("authPassword").value = "";
    allApplications = [];
    allMessages = [];
  }
});