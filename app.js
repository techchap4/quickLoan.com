// =====================================================
//  QuickLoan - app.js
//  Uses SUPABASE_URL, SUPABASE_KEY, ANNUAL_INTEREST_RATE,
//  CURRENCY, WEB3FORMS_ACCESS_KEY, CONTACT_EMAIL from config.js
// =====================================================

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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


// =====================================================
//  FULL-SCREEN OVERLAY (loading -> success / error)
// =====================================================

function showOverlay(state, title, text) {
  $("overlay").hidden = false;
  $("overlaySpinner").hidden = state !== "loading";
  $("overlayOk").hidden = state !== "success";
  $("overlayFail").hidden = state !== "error";
  $("overlayClose").hidden = state === "loading";
  $("overlayTitle").textContent = title;
  $("overlayText").textContent = text;
  if (state !== "loading") $("overlayClose").focus();
}

function hideOverlay() {
  $("overlay").hidden = true;
}

$("overlayClose").addEventListener("click", hideOverlay);


// =====================================================
//  PART 1: LOAN CALCULATOR
// =====================================================

function monthlyPayment(principal, annualRate, months) {
  const r = annualRate / 100 / 12;
  if (r === 0) return principal / months;
  return (principal * r) / (1 - Math.pow(1 + r, -months));
}

function updateCalculator() {
  const amount = Number($("calcAmount").value);
  const months = Number($("calcTerm").value);

  const monthly = monthlyPayment(amount, ANNUAL_INTEREST_RATE, months);
  const total = monthly * months;

  $("calcAmountLabel").textContent = money(amount);
  $("calcTermLabel").textContent = months + " months";
  $("rateText").textContent = ANNUAL_INTEREST_RATE + "%";
  $("monthlyResult").textContent = money(monthly);
  $("totalResult").textContent = money(total);
  $("interestResult").textContent = money(total - amount);
}

$("calcAmount").addEventListener("input", updateCalculator);
$("calcTerm").addEventListener("input", updateCalculator);
updateCalculator();


// =====================================================
//  PART 2: SIGN UP / EMAIL CODE (OTP) / LOGIN / RESET
// =====================================================

const MIN_PASSWORD = 8;
let pendingEmail = "";       // the email waiting for its verification code
let resendTimer = null;

// Switch between the three boxes: "login", "otp", "forgot"
function showPanel(name) {
  $("panelLogin").hidden = name !== "login";
  $("panelOtp").hidden = name !== "otp";
  $("panelForgot").hidden = name !== "forgot";
  ["authMessage", "otpMessage", "forgotMessage"].forEach((id) => showMessage($(id), "", ""));
}

// Stops people spamming "Resend code" (waits 60 seconds)
function startResendCooldown() {
  let left = 60;
  const btn = $("otpResendBtn");
  clearInterval(resendTimer);
  btn.disabled = true;
  btn.textContent = "Resend code (" + left + ")";
  resendTimer = setInterval(() => {
    left--;
    if (left <= 0) {
      clearInterval(resendTimer);
      btn.disabled = false;
      btn.textContent = "Resend code";
    } else {
      btn.textContent = "Resend code (" + left + ")";
    }
  }, 1000);
}

function goToOtp(email, note) {
  pendingEmail = email;
  $("otpEmailText").textContent = email;
  $("otpCode").value = "";
  showPanel("otp");
  showMessage($("otpMessage"), note, "success");
  startResendCooldown();
  $("otpCode").focus();
}

// ----- Sign up: creates the account and emails a 6-digit code -----
$("signupBtn").addEventListener("click", async () => {
  const email = $("authEmail").value.trim();
  const password = $("authPassword").value;
  const msg = $("authMessage");

  if (!isEmail(email)) return showMessage(msg, "Enter a valid email address.", "error");
  if (password.length < MIN_PASSWORD) {
    return showMessage(msg, "Your password must be at least " + MIN_PASSWORD + " characters.", "error");
  }

  $("signupBtn").disabled = true;
  showMessage(msg, "Creating account...", "");
  const { data, error } = await db.auth.signUp({ email, password });
  $("signupBtn").disabled = false;

  if (error) return showMessage(msg, error.message, "error");

  // Supabase hides "already registered" by returning a user with no identities.
  if (data.user && data.user.identities && data.user.identities.length === 0) {
    return showMessage(msg, "This email already has an account. Log in instead, or use \"Forgot your password?\".", "error");
  }

  // Email confirmation ON -> no session yet, user must enter the code.
  if (!data.session) {
    goToOtp(email, "Account created! We sent a 6-digit code to your email.");
  }
  // If a session exists, confirmation is OFF in Supabase (see SETUP.md) and onAuthStateChange logs them in.
});

// ----- Check the 6-digit code -----
async function verifyOtp() {
  const token = $("otpCode").value.replace(/\D/g, "");
  const msg = $("otpMessage");

  if (token.length !== 6) return showMessage(msg, "Enter the 6-digit code from your email.", "error");

  $("otpVerifyBtn").disabled = true;
  showMessage(msg, "Checking code...", "");
  const { error } = await db.auth.verifyOtp({ email: pendingEmail, token, type: "signup" });
  $("otpVerifyBtn").disabled = false;

  if (error) {
    return showMessage(msg, "That code is wrong or has expired. Check it, or request a new code.", "error");
  }
  // Success: onAuthStateChange logs the user in.
}

$("otpVerifyBtn").addEventListener("click", verifyOtp);
$("otpCode").addEventListener("keydown", (e) => { if (e.key === "Enter") verifyOtp(); });

// ----- Send a new code -----
$("otpResendBtn").addEventListener("click", async () => {
  const msg = $("otpMessage");
  showMessage(msg, "Sending a new code...", "");
  const { error } = await db.auth.resend({ type: "signup", email: pendingEmail });
  if (error) return showMessage(msg, error.message, "error");
  showMessage(msg, "A new code was sent. Use the newest one.", "success");
  startResendCooldown();
});

$("otpBackLink").addEventListener("click", () => showPanel("login"));

// ----- Log in -----
async function login() {
  const email = $("authEmail").value.trim();
  const password = $("authPassword").value;
  const msg = $("authMessage");

  if (!email || !password) return showMessage(msg, "Enter your email and password.", "error");

  $("loginBtn").disabled = true;
  showMessage(msg, "Logging in...", "");
  const { error } = await db.auth.signInWithPassword({ email, password });
  $("loginBtn").disabled = false;

  if (!error) return;   // onAuthStateChange takes over

  // Account exists but the email was never verified -> send a fresh code.
  if (error.code === "email_not_confirmed" || /not confirmed/i.test(error.message)) {
    await db.auth.resend({ type: "signup", email });
    return goToOtp(email, "Your email is not verified yet. We sent you a new 6-digit code.");
  }
  showMessage(msg, error.message, "error");
}

$("loginBtn").addEventListener("click", login);
$("authPassword").addEventListener("keydown", (e) => { if (e.key === "Enter") login(); });

$("logoutBtn").addEventListener("click", async () => {
  await db.auth.signOut();
});

// ----- Forgot password: email a reset link -----
$("forgotLink").addEventListener("click", () => {
  showPanel("forgot");
  $("forgotEmail").value = $("authEmail").value.trim();
  $("forgotEmail").focus();
});
$("forgotBackLink").addEventListener("click", () => showPanel("login"));

$("forgotSendBtn").addEventListener("click", async () => {
  const email = $("forgotEmail").value.trim();
  const msg = $("forgotMessage");

  if (!isEmail(email)) return showMessage(msg, "Enter a valid email address.", "error");

  $("forgotSendBtn").disabled = true;
  showMessage(msg, "Sending...", "");

  // The link in the email opens reset.html, where the user chooses a new password.
  const redirectTo = new URL("reset.html", window.location.href).href;
  const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo });

  // Re-enable after 30s so the button cannot be spammed.
  setTimeout(() => { $("forgotSendBtn").disabled = false; }, 30000);

  if (error) {
    $("forgotSendBtn").disabled = false;
    return showMessage(msg, error.message, "error");
  }
  // Same wording whether or not the email exists (so strangers cannot probe accounts).
  showMessage(msg, "If an account exists for that email, a reset link is on its way. Check your inbox and spam folder.", "success");
});


// =====================================================
//  PART 3: APPLY FOR A LOAN
// =====================================================

$("loanForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const fullName = $("fullName").value.trim();
  const phone = $("phone").value.trim();
  const amount = Number($("amount").value);
  const termMonths = Number($("termMonths").value);
  const purpose = $("purpose").value;
  const msg = $("formMessage");

  showMessage(msg, "", "");
  if (!fullName || !phone) {
    return showMessage(msg, "Please enter your name and phone number.", "error");
  }
  if (!(amount >= 100 && amount <= 50000)) {
    return showMessage(msg, "Amount must be between 100 and 50,000.", "error");
  }
  if (!Number.isInteger(termMonths) || termMonths < 1 || termMonths > 60) {
    return showMessage(msg, "Months must be a whole number from 1 to 60.", "error");
  }

  $("submitBtn").disabled = true;
  showOverlay("loading", "Submitting your application...", "Please wait. Do not close or refresh this page.");
  const started = Date.now();

  let error = null;
  try {
    // user_id and status are filled in by the database (auth.uid() and 'pending').
    const result = await db.from("loan_applications").insert({
      full_name: fullName,
      phone: phone,
      amount: amount,
      term_months: termMonths,
      purpose: purpose
    });
    error = result.error;
  } catch (e) {
    error = { message: "Network problem. Check your connection and try again." };
  }

  // Keep the loading screen up for a moment so it never just flashes.
  const wait = 1200 - (Date.now() - started);
  if (wait > 0) await sleep(wait);

  $("submitBtn").disabled = false;

  if (error) {
    return showOverlay("error", "Submission failed",
      "Your application was not sent. " + error.message + " Please try again.");
  }

  showOverlay("success", "Application submitted",
    "Thank you. Your application is now under review by our team. " +
    "Approval is not guaranteed. You can follow its status under \"My applications\".");
  $("loanForm").reset();
  loadApplications();
});


// =====================================================
//  PART 4: SHOW MY APPLICATIONS
// =====================================================

async function loadApplications() {
  const { data, error } = await db
    .from("loan_applications")
    .select("*")
    .order("created_at", { ascending: false });

  const body = $("applicationsBody");
  body.innerHTML = "";

  if (error) {
    $("emptyMessage").hidden = false;
    $("emptyMessage").textContent = "Could not load applications: " + error.message;
    return;
  }

  $("emptyMessage").hidden = data.length > 0;
  $("emptyMessage").textContent = "You have not applied yet.";

  data.forEach((row) => {
    const tr = document.createElement("tr");

    addCell(tr, new Date(row.created_at).toLocaleDateString());
    addCell(tr, money(row.amount));
    addCell(tr, String(row.term_months));
    addCell(tr, row.purpose || "-");

    const statusTd = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = "badge " + row.status;
    badge.textContent = row.status;
    statusTd.appendChild(badge);
    tr.appendChild(statusTd);

    body.appendChild(tr);
  });
}

function addCell(tr, text) {
  const td = document.createElement("td");
  td.textContent = text;
  tr.appendChild(td);
}


// =====================================================
//  PART 5: CONTACT US  (saved in Supabase + emailed to you)
// =====================================================

$("contactForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const name = $("contactName").value.trim();
  const email = $("contactEmail").value.trim();
  const message = $("contactMessage").value.trim();
  const status = $("contactStatus");

  // Hidden spam trap: bots fill it in, people do not.
  if ($("contactTrap").value) return;

  if (!name) return showMessage(status, "Please enter your name.", "error");
  if (!isEmail(email)) return showMessage(status, "Please enter a valid email address.", "error");
  if (message.length < 5) return showMessage(status, "Please write a message.", "error");

  $("contactBtn").disabled = true;
  showOverlay("loading", "Sending your message...", "One moment.");
  const started = Date.now();

  // 1) Save in Supabase (you can read it in the admin dashboard)
  const saveToDb = db.from("contact_messages")
    .insert({ name, email, message })
    .then((r) => !r.error)
    .catch(() => false);

  // 2) Email it to the site owner
  const sendEmail = (async () => {
    if (!WEB3FORMS_ACCESS_KEY || WEB3FORMS_ACCESS_KEY.startsWith("PASTE_")) return false;
    try {
      const res = await fetch("https://api.web3forms.com/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({
          access_key: WEB3FORMS_ACCESS_KEY,
          subject: "QuickLoan contact message from " + name,
          from_name: "QuickLoan website",
          name: name,
          email: email,          // so you can just hit "Reply" in Gmail
          message: message
        })
      });
      const json = await res.json();
      return !!json.success;
    } catch (e) {
      return false;
    }
  })();

  const [saved, emailed] = await Promise.all([saveToDb, sendEmail]);

  const wait = 1000 - (Date.now() - started);
  if (wait > 0) await sleep(wait);

  $("contactBtn").disabled = false;

  if (saved || emailed) {
    showOverlay("success", "Message sent", "Thank you, " + name + ". We will reply to " + email + " as soon as we can.");
    $("contactForm").reset();
    showMessage(status, "", "");
  } else {
    showOverlay("error", "Message not sent",
      "Something went wrong. Please try again, or email us directly at " + CONTACT_EMAIL + ".");
  }
});


// =====================================================
//  PART 6: REACT TO LOGIN STATE
// =====================================================

db.auth.onAuthStateChange((event, session) => {
  const loggedIn = !!session;

  $("loggedOutView").hidden = loggedIn;
  $("loggedInView").hidden = !loggedIn;
  $("userBox").hidden = !loggedIn;
  $("userEmail").textContent = loggedIn ? session.user.email : "";

  if (loggedIn) {
    setTimeout(loadApplications, 0);
    setTimeout(checkAdminLink, 0);
    clearInterval(resendTimer);
  } else {
    $("adminLink").hidden = true;
    $("applicationsBody").innerHTML = "";
    $("authPassword").value = "";
    $("otpCode").value = "";
    showPanel("login");
  }
});

// Show the "Admin" link only if this user is in the admins table.
// (Convenience only. Real protection is in the database rules.)
async function checkAdminLink() {
  const { data } = await db.from("admins").select("user_id").maybeSingle();
  $("adminLink").hidden = !data;
}