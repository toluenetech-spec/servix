#!/usr/bin/env python3
"""Generate the screens Stitch did not deliver, in the same (corrected) design system.

The <head> (fonts, Tailwind config with the Servix brand palette, type scale, spacing) is copied
verbatim from corrected/s8_home_customer.html so every new screen shares the exact theme.
Output: docs/stitch-design/new/*.html.   Run: python3 tools/new_screens.py
"""
from __future__ import annotations
import pathlib, re, sys
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from correct import nav_html  # canonical bottom bar

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "new"; OUT.mkdir(exist_ok=True)
head_src = (ROOT / "corrected" / "s8_home_customer.html").read_text(encoding="utf-8")
HEAD = head_src[: head_src.find("</head>")]
HEAD = re.sub(r"<title>.*?</title>", "", HEAD, flags=re.S)

ICON = '<span class="material-symbols-outlined text-[{s}px]"{f}>{n}</span>'
def ic(n, s=24, fill=False):
    return ICON.format(n=n, s=s, f=' style="font-variation-settings: \'FILL\' 1;"' if fill else "")

def page(title: str, body: str, nav: str = "", note: str = "") -> str:
    return (f"{HEAD}<title>Servix · {title}</title></head>\n"
            f"<body class=\"bg-surface font-body-md text-on-surface antialiased flex flex-col min-h-screen\">\n"
            f"<!-- {note} -->\n{body}\n{nav}\n</body></html>\n")

def topbar(title: str, back=True, right: str = "") -> str:
    left = (f'<button class="w-10 h-10 -ml-2 rounded-full flex items-center justify-center text-on-surface" aria-label="Back">{ic("arrow_back")}</button>'
            if back else "")
    return (f'<header class="sticky top-0 z-40 bg-surface/90 backdrop-blur-xl border-b border-outline-variant pt-safe">'
            f'<div class="h-14 px-gutter flex items-center gap-2">{left}'
            f'<h1 class="font-title-lg text-title-lg text-on-surface flex-1 truncate">{title}</h1>{right}</div></header>')

def primary_btn(label, icon=None, extra=""):
    return (f'<button class="w-full min-h-[52px] rounded-lg bg-primary text-on-primary font-label-lg text-label-lg '
            f'flex items-center justify-center gap-2 active:scale-[0.98] transition-transform {extra}">'
            f'{ic(icon, 20) if icon else ""}{label}</button>')
def secondary_btn(label, icon=None, extra=""):
    return (f'<button class="w-full min-h-[52px] rounded-lg border border-outline bg-surface-container-lowest text-primary font-label-lg text-label-lg '
            f'flex items-center justify-center gap-2 active:scale-[0.98] transition-transform {extra}">'
            f'{ic(icon, 20) if icon else ""}{label}</button>')
def field(label, placeholder, type_="text", icon=None, trailing=""):
    return (f'<label class="block"><span class="font-label-md text-label-md text-on-surface-variant">{label}</span>'
            f'<div class="mt-1.5 h-[52px] rounded-lg border border-outline bg-surface-container-lowest flex items-center px-4 gap-3 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15">'
            f'{ic(icon, 20) if icon else ""}<input class="flex-1 bg-transparent outline-none font-body-lg text-body-lg placeholder:text-on-surface-variant/70" type="{type_}" placeholder="{placeholder}"/>{trailing}</div></label>')
def eyebrow(t): return f'<span class="font-label-md text-label-md tracking-wider uppercase font-semibold text-secondary">{t}</span>'
def h1(t): return f'<h2 class="font-headline-lg-mobile text-headline-lg-mobile text-on-surface mt-1">{t}</h2>'
def sub(t): return f'<p class="font-body-md text-body-md text-on-surface-variant mt-2">{t}</p>'
def card(inner, extra=""): return f'<div class="rounded-2xl bg-surface-container-lowest border border-outline-variant p-4 {extra}">{inner}</div>'
def avatar(initials, size=10, cls=""):
    return (f'<span class="w-{size} h-{size} rounded-full bg-primary-fixed text-primary font-label-lg text-label-lg flex items-center justify-center shrink-0 {cls}">{initials}</span>')
def steps(current: int, total=4):
    dots = "".join(f'<span class="h-1.5 flex-1 rounded-full {"bg-primary" if i < current else "bg-surface-container-highest"}"></span>' for i in range(total))
    return f'<div class="flex gap-1.5 mt-4" aria-label="Step {current} of {total}">{dots}</div>'
def status_chip(label, tone):
    tones = {"neutral": "bg-surface-container text-on-surface-variant", "info": "bg-primary-fixed text-primary",
             "warn": "bg-tertiary-container text-on-tertiary-container", "ok": "bg-secondary-container text-primary",
             "bad": "bg-error-container text-on-error-container"}
    return f'<span class="inline-flex items-center h-6 px-2.5 rounded-full font-label-md text-label-md font-semibold uppercase tracking-wide {tones[tone]}">{label}</span>'

AUTH_WRAP = 'main class="flex-1 flex flex-col px-margin pt-safe pb-safe"'

# ───────────────────────────────────────────── S1 splash
def s1():
    body = f'''
<main class="flex-1 flex flex-col items-center justify-center bg-primary text-on-primary pt-safe pb-safe">
  <div class="flex flex-col items-center gap-4">
    <span class="w-20 h-20 rounded-2xl bg-on-primary/10 border border-on-primary/15 flex items-center justify-center">{ic("handyman", 40, True)}</span>
    <span class="font-headline-md text-headline-md tracking-tight">Servix</span>
  </div>
  <div class="absolute bottom-12 flex flex-col items-center gap-3">
    <span class="w-6 h-6 rounded-full border-2 border-on-primary/30 border-t-on-primary animate-spin" role="status" aria-label="Loading"></span>
    <span class="font-body-sm text-body-sm text-on-primary/70">Preparing your secure session…</span>
  </div>
</main>'''
    return page("Splash", body, note="S1 · Splash: 300 ms logo fade+scale (0.96→1); no network copy; routes to S2 or Home. Compose: Box(Modifier.background(DeepForest)).")

# ───────────────────────────────────────────── S6 security stages
def s6_stage(stage, step, title, lead, inner, cta, file_title, extra_links=""):
    body = f'''
<{AUTH_WRAP}>
  <div class="h-14 flex items-center"><button class="w-10 h-10 -ml-2 rounded-full flex items-center justify-center" aria-label="Back">{ic("arrow_back")}</button></div>
  <div class="flex-1 flex flex-col pt-2">
    {eyebrow("Servix · Account security")}
    {h1(title)}
    {sub(lead)}
    {steps(step)}
    <div class="mt-8 flex flex-col gap-4">{inner}</div>
  </div>
  <div class="flex flex-col gap-3 pt-6 pb-4">{primary_btn(cta)}{extra_links}</div>
</main>'''
    return page(file_title, body, note=f"S6 · stage `{stage}` from POST auth/security/status. Same layout as Stitch s6; only content differs per stage.")

def s6_all():
    code = field("6-digit code", "••• •••", "tel", "pin")
    out = {}
    out["s6a_security_email.html"] = s6_stage("email", 1, "Check your inbox", "We sent a 6-digit code to o•••••@gmail.com. It expires in 10 minutes.",
        code + '<p class="font-body-sm text-body-sm text-on-surface-variant text-center">Resend in <span class="font-semibold text-on-surface">42s</span></p>',
        "Verify email", "Security · email")
    out["s6b_security_enroll.html"] = s6_stage("enroll", 2, "Choose your security method", "Add Google Authenticator so only you can sign in.",
        card(f'''<div class="flex items-center gap-3">{ic("phonelink_lock", 24)}<span class="font-title-md text-title-md">Google Authenticator</span></div>
<ol class="mt-3 flex flex-col gap-2 font-body-md text-body-md text-on-surface-variant list-decimal pl-5">
<li>Open Google Authenticator and tap <b class="text-on-surface">+</b>.</li><li>Choose <b class="text-on-surface">Enter a setup key</b>.</li><li>Paste the key below, then enter the 6-digit code.</li></ol>
<div class="mt-3 flex items-center gap-2 rounded-lg bg-surface-container px-3 h-12"><code class="flex-1 font-body-md text-body-md tracking-widest truncate">JBSW Y3DP EHPK 3PXP</code>
<button class="font-label-lg text-label-lg text-primary px-2 h-9">Copy key</button></div>
<div class="mt-3 grid grid-cols-2 gap-2">{secondary_btn("Open app", "open_in_new", "min-h-[44px]")}<span></span></div>''') + code,
        "Confirm authenticator", "Security · enroll",
        '<button class="w-full min-h-[44px] font-label-lg text-label-lg text-primary">Choose a different method</button>')
    out["s6c_security_factor.html"] = s6_stage("factor", 3, "One more check. Then you're in.", "Enter the code from your authenticator app.",
        code, "Verify security code", "Security · factor",
        '<button class="w-full min-h-[44px] font-label-lg text-label-lg text-primary">Lost access? Use a recovery code</button>'
        '<button class="w-full min-h-[44px] font-label-lg text-label-lg text-on-surface-variant">Contact Servix support</button>')
    codes = "".join(f'<li class="font-body-md text-body-md tracking-widest text-on-surface">{c}</li>' for c in
                    ["7K2M-9QXA", "H4PD-2LRN", "B8VT-6ZJC", "M3WY-1NKF", "Q9SR-5DHE", "X6LG-8TPB", "C2NA-4VMW", "R7JE-3KQD"])
    out["s6d_security_recovery.html"] = s6_stage("recovery", 4, "Keep a way back in", "Save these recovery codes somewhere private. Each code works once.",
        card(f'<ul class="grid grid-cols-2 gap-y-2 gap-x-6">{codes}</ul>') + secondary_btn("Copy recovery codes", "content_copy", "min-h-[48px]") +
        '<label class="flex items-start gap-3 mt-2"><input type="checkbox" class="mt-1 w-5 h-5 accent-[#12372A]"/><span class="font-body-md text-body-md text-on-surface">I have saved my recovery codes somewhere private.</span></label>',
        "Finish securely", "Security · recovery")
    checklist = "".join(f'<li class="flex items-center gap-2 font-body-sm text-body-sm {"text-primary" if ok else "text-on-surface-variant"}">{ic("check_circle" if ok else "radio_button_unchecked", 18, ok)}{t}</li>'
                        for t, ok in [("At least 8 characters", True), ("Upper and lower case", True), ("A number", False), ("A symbol", False), ("Passwords match", False)])
    out["s6e_set_new_password.html"] = s6_stage("reset_password", 4, "Choose a new password", "Use something you don't use anywhere else.",
        field("New password", "Create a password", "password", "lock", f'<button class="text-on-surface-variant" aria-label="Show password">{ic("visibility", 20)}</button>') +
        field("Confirm password", "Repeat your password", "password", "lock") +
        f'<ul class="flex flex-col gap-1.5 px-1" aria-live="polite">{checklist}</ul>',
        "Save new password", "Security · new password")
    out["s6f_security_complete.html"] = s6_stage("finish", 4, "Your checks are complete", "Thanks for keeping your account safe.",
        f'<div class="flex flex-col items-center py-6">{ic("verified_user", 72, True).replace("material-symbols-outlined", "material-symbols-outlined text-primary")}</div>',
        "Finish signing in", "Security · complete")
    return out

# ───────────────────────────────────────────── S8 guest + professional home
def home_header(greeting, line2, right):
    return (f'<header class="sticky top-0 z-40 bg-surface/90 backdrop-blur-xl pt-safe"><div class="h-16 px-gutter flex items-center justify-between">'
            f'<div class="flex flex-col min-w-0"><span class="font-title-lg text-title-lg text-on-surface truncate">{greeting}</span>'
            f'<span class="font-body-sm text-body-sm text-on-surface-variant truncate">{line2}</span></div><div class="flex items-center gap-1">{right}</div></div></header>')
def search_field():
    return (f'<div class="px-gutter mt-2"><button class="w-full h-[52px] rounded-lg bg-surface-container-lowest border border-outline flex items-center px-4 gap-3 text-left">'
            f'{ic("search", 22)}<span class="font-body-lg text-body-lg text-on-surface-variant">What do you need done?</span></button></div>')
def section(title, action="See all"):
    return (f'<div class="px-gutter mt-7 mb-3 flex items-center justify-between"><h3 class="font-title-md text-title-md text-on-surface">{title}</h3>'
            f'<button class="font-label-lg text-label-lg text-primary">{action}</button></div>')
def categories():
    chips = "".join(f'<button class="shrink-0 h-10 px-4 rounded-full bg-surface-container-lowest border border-outline-variant flex items-center gap-2 font-label-lg text-label-lg text-on-surface">{ic(i, 18)}{n}</button>'
                    for n, i in [("Electrical", "bolt"), ("Plumbing", "plumbing"), ("AC & Fridge", "mode_fan"), ("Cleaning", "cleaning_services"), ("Painting", "format_paint"), ("Tech repairs", "devices")])
    return f'<div class="flex gap-2 overflow-x-auto px-gutter pb-1 [scrollbar-width:none]">{chips}</div>'
def pro_row(n, t, r, c, loc, price, initials):
    return card(f'''<div class="flex items-center gap-3">{avatar(initials, 12)}<div class="flex-1 min-w-0">
<div class="flex items-center gap-1"><span class="font-title-md text-title-md truncate">{n}</span>{ic("verified", 16, True).replace("material-symbols-outlined", "material-symbols-outlined text-primary")}</div>
<span class="block font-body-sm text-body-sm text-on-surface-variant truncate">{t}</span>
<span class="block font-body-sm text-body-sm text-on-surface-variant">★ {r} ({c}) · {loc}</span></div>
<span class="font-label-lg text-label-lg text-primary whitespace-nowrap">₦{price} starting</span></div>''', "mx-gutter mb-2")
def ai_card():
    return card(f'''<div class="flex items-start gap-3"><span class="w-10 h-10 rounded-full bg-primary text-on-primary flex items-center justify-center">{ic("auto_awesome", 20, True)}</span>
<div class="flex-1"><span class="font-title-md text-title-md block">Servix AI</span><span class="font-body-sm text-body-sm text-on-surface-variant block mt-0.5">Describe the job and get a fair price range before you book.</span>
<button class="mt-3 h-10 px-4 rounded-lg bg-primary text-on-primary font-label-lg text-label-lg">Ask Servix AI</button></div></div>''', "mx-gutter mt-7 bg-primary-fixed/40")

def s8_guest():
    body = f'''
{home_header("Welcome", "Lagos", '<button class="h-10 px-3 rounded-lg font-label-lg text-label-lg text-primary">Sign in</button>')}
<main class="flex-1 pb-28">
{search_field()}
{card(f'<span class="font-title-md text-title-md block">Sign in to book and track jobs</span><span class="font-body-sm text-body-sm text-on-surface-variant block mt-1">Your bookings, payments and AI history stay in one place.</span><div class="grid grid-cols-2 gap-2 mt-4">{primary_btn("Sign in", extra="min-h-[44px]")}{secondary_btn("Create account", extra="min-h-[44px]")}</div>', "mx-gutter mt-4")}
{section("Browse by category")}{categories()}
{section("Recommended for you")}
{pro_row("Emeka Nwosu", "AC &amp; Fridge technician", "4.9", 128, "Ikeja", "15,000", "EN")}
{pro_row("Amaka Obi", "Painter", "4.8", 94, "Lekki", "22,000", "AO")}
{pro_row("Bayo Alabi", "Electrician", "4.8", 52, "Ikeja", "12,000", "BA")}
{ai_card()}
</main>'''
    return page("Home (guest)", body, nav_html("home").replace('data-path="chats"', 'data-path="chats" hidden').replace('data-path="bookings"', 'data-path="bookings" hidden'),
                note="S8 guest: owner decision 2026-11-07 — guest bottom bar is Home · Explore · Account only (Chats/Bookings hidden). Second line = stored city, never the date.")

def s8_pro():
    job = lambda chip, tone, svc, who, when, cta: card(f'''<div class="flex items-center justify-between">{status_chip(chip, tone)}<span class="font-body-sm text-body-sm text-on-surface-variant">{when}</span></div>
<span class="font-title-md text-title-md block mt-2">{svc}</span><span class="font-body-sm text-body-sm text-on-surface-variant block">{who}</span>
<div class="grid grid-cols-2 gap-2 mt-3">{primary_btn(cta, extra="min-h-[44px]")}{secondary_btn("Message", "chat_bubble", "min-h-[44px]")}</div>''', "mx-gutter mb-2")
    body = f'''
{home_header("Good afternoon, Bayo", "Friday, 7 November", f'<button class="relative w-10 h-10 rounded-full flex items-center justify-center" aria-label="Notifications">{ic("notifications")}<span class="absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full bg-tertiary"></span></button>{avatar("BA", 9)}')}
<main class="flex-1 pb-28">
{section("Your jobs", "See all")}
{job("Requested", "info", "Electrical wiring repair", "Olumide A. · Ikeja", "Today 11:30", "Accept")}
{job("In progress", "warn", "Distribution box fix", "Chinwe O. · Maryland", "Started 9:10", "Mark delivered")}
{job("Delivered", "ok", "Socket replacement ×3", "Tolu B. · Ogba", "Yesterday", "View")}
{section("This week", "")}
<div class="grid grid-cols-3 gap-2 px-gutter">
{card('<span class="font-currency-display text-currency-display block text-primary">₦86k</span><span class="font-label-md text-label-md text-on-surface-variant">Earned</span>', "text-center")}
{card('<span class="font-currency-display text-currency-display block text-primary">4</span><span class="font-label-md text-label-md text-on-surface-variant">Jobs done</span>', "text-center")}
{card('<span class="font-currency-display text-currency-display block text-primary">4.8★</span><span class="font-label-md text-label-md text-on-surface-variant">Rating</span>', "text-center")}
</div>
{section("Profile strength", "Edit profile")}
{card('<div class="flex items-center justify-between"><span class="font-title-md text-title-md">72% complete</span><span class="font-body-sm text-body-sm text-on-surface-variant">3 steps left</span></div><div class="h-2 rounded-full bg-surface-container-highest mt-3"><div class="h-2 rounded-full bg-primary w-[72%]"></div></div><ul class="mt-3 flex flex-col gap-1.5 font-body-sm text-body-sm text-on-surface-variant"><li>• Add a short video to your gallery</li><li>• Upload your CV (PDF)</li><li>• Add one more service</li></ul>', "mx-gutter")}
{ai_card()}
</main>'''
    return page("Home (professional)", body, nav_html("home", badge=1),
                note="S8 professional: owner decision 2026-11-07 — jobs + This week + Profile strength. Data: GET bookings (role=professional), GET account/overview.")

# ───────────────────────────────────────────── S15 notifications
def s15():
    def row(title, body, when, unread, icon):
        dot = '<span class="w-2 h-2 rounded-full bg-tertiary mt-2"></span>' if unread else ""
        return (f'<li class="flex gap-3 px-gutter py-3.5 {"bg-primary-fixed/30" if unread else ""}"><span class="w-10 h-10 rounded-full {"bg-primary text-on-primary" if unread else "bg-surface-container text-on-surface-variant"} flex items-center justify-center shrink-0">{ic(icon, 20)}</span>'
                f'<div class="flex-1 min-w-0"><div class="flex items-center justify-between gap-2"><span class="font-title-md text-title-md truncate {"" if unread else "font-medium"}">{title}</span><span class="font-body-sm text-body-sm text-on-surface-variant shrink-0">{when}</span></div>'
                f'<p class="font-body-sm text-body-sm text-on-surface-variant mt-0.5 line-clamp-2">{body}</p></div>{dot}</li>')
    rows = "".join([
        row("Work delivered", "Bayo Alabi marked Electrical wiring repair as complete. Confirm when you're happy.", "2m", True, "task_alt"),
        row("New message", "Ada Nwosu: I've shared the first draft of the logo.", "18m", True, "chat_bubble"),
        row("Booking accepted", "Tunde Adeleke accepted Plumbing pipe maintenance for today, 4:00 PM.", "3h", False, "event_available"),
        row("Payment received", "₦28,500 received for Electrical wiring repair.", "Yesterday", False, "payments"),
        row("Security", "New sign-in on Pixel 7 · Lagos. Not you? Review your security settings.", "Tue", False, "shield"),
    ])
    body = f'''
{topbar("Notifications", right='<button class="h-9 px-3 rounded-lg font-label-lg text-label-lg text-primary">Mark all read</button>')}
<main class="flex-1 pb-28"><ul class="divide-y divide-outline-variant">{rows}</ul>
<!-- EMPTY STATE (shown when list is empty) -->
<div class="hidden flex-col items-center text-center px-10 py-20" data-state="empty">{ic("notifications_off", 48)}<span class="font-title-md text-title-md mt-4">No notifications yet</span><span class="font-body-sm text-body-sm text-on-surface-variant mt-1">Booking updates and account messages will appear here.</span></div>
</main>'''
    return page("Notifications", body, nav_html("account"), note="S15: GET account/notifications; tap → POST account/notifications/read {ids}; link→booking opens S13. Pull-to-refresh.")

# ───────────────────────────────────────────── S16 account hub
def s16():
    def row(icon, t, s_, last=False):
        return (f'<li><button class="w-full flex items-center gap-3 px-4 min-h-[60px] text-left {"" if last else "border-b border-outline-variant"}">'
                f'<span class="w-9 h-9 rounded-full bg-surface-container text-primary flex items-center justify-center">{ic(icon, 20)}</span>'
                f'<span class="flex-1 min-w-0"><span class="block font-title-md text-title-md font-medium">{t}</span><span class="block font-body-sm text-body-sm text-on-surface-variant truncate">{s_}</span></span>{ic("chevron_right", 22)}</button></li>')
    def group(title, items):
        return (f'<div class="px-gutter mt-6"><span class="font-label-md text-label-md uppercase tracking-wider text-on-surface-variant font-semibold px-1">{title}</span>'
                f'<ul class="mt-2 rounded-2xl bg-surface-container-lowest border border-outline-variant overflow-hidden">{"".join(items)}</ul></div>')
    body = f'''
{topbar("Account", back=False)}
<main class="flex-1 pb-28">
<div class="px-gutter pt-4 flex items-center gap-4">{avatar("OA", 16, "text-headline-md")}<div class="min-w-0"><span class="font-title-lg text-title-lg block truncate">Olumide Adebayo</span><span class="font-body-sm text-body-sm text-on-surface-variant block truncate">olumide@example.com</span>{status_chip("Customer", "info")}</div></div>
{group("Account", [row("person", "Profile", "Name and photo"), row("bookmark", "Saved", "Professionals you kept"), row("notifications", "Notifications", "2 unread"),
                   row("payments", "Payments", "Paid through Servix · receipts on the website"), row("workspace_premium", "Plan", "What your account includes"), row("shield", "Security", "Sign-in protection", True)])}
{group("This device", [row("smartphone", "This device", "Sessions and app version"), row("system_update", "Updates", "App version 1.1.0", True)])}
{group("Legal", [row("policy", "Privacy and terms", "How Servix handles your data", True)])}
<div class="px-gutter mt-6 flex flex-col gap-2">{secondary_btn("Sign out", "logout")}<button class="min-h-[44px] font-label-lg text-label-lg text-on-surface-variant">Manage account on the website</button></div>
</main>'''
    return page("Account", body, nav_html("account"), note="S16: owner decision 2026-11-07 — Payments is a ROW here (not a tab). Professional role adds 'My services' + 'Earnings' rows; guest shows sign-in card instead of header.")

# ───────────────────────────────────────────── S13 status variants
def s13_states():
    variants = [
        ("pending_payment", "warn", "Payment due", "Pay ₦28,500 through Servix to confirm this booking. The professional is paid after you confirm the work.", "Pay now", "payments"),
        ("requested", "info", "Waiting for Bayo to accept", "Most professionals respond within a few hours. You'll get a notification.", "Message Bayo", "chat_bubble"),
        ("accepted", "info", "Booking accepted", "Bayo Alabi will arrive Thursday, 7 Nov at 11:30 AM.", "Message Bayo", "chat_bubble"),
        ("in_progress", "warn", "Work in progress", "Bayo Alabi started at 11:30 AM.", "Message Bayo", "chat_bubble"),
        ("delivered", "warn", "Awaiting your confirmation", "Bayo marked this job complete. Inspect the work, then confirm.", "Confirm completion", "check_circle"),
        ("completed", "ok", "Completed", "Thanks for confirming. ₦28,500 has been released to Bayo Alabi.", "Leave a review", "rate_review"),
        ("disputed", "bad", "Under review", "Your payment stays on hold while the Servix team reviews the case with Bayo Alabi.", "Open support chat", "support_agent"),
        ("cancelled", "neutral", "Cancelled", "This booking was cancelled on 6 Nov. Any payment made is refunded to your card within 5–7 days.", "Book again", "refresh"),
        ("declined", "neutral", "Declined", "Bayo Alabi couldn't take this job. Find another professional.", "Find a professional", "search"),
        ("refunded", "ok", "Refunded", "₦28,500 was refunded to your card.", "Book again", "refresh"),
    ]
    cards = "".join(card(f'''<div class="flex items-center justify-between">{status_chip(s_.replace("_", " "), tone)}<code class="font-body-sm text-body-sm text-on-surface-variant">status = {s_}</code></div>
<span class="font-title-lg text-title-lg block mt-2">{t}</span><p class="font-body-md text-body-md text-on-surface-variant mt-1">{b}</p>
<div class="mt-3">{primary_btn(cta, icon, "min-h-[44px]")}</div>''', "mx-gutter mb-3") for s_, tone, t, b, cta, icon in variants)
    body = f'''{topbar("Booking status header — all variants")}<main class="flex-1 py-4 pb-28">
<p class="px-gutter font-body-sm text-body-sm text-on-surface-variant mb-4">Reference only: the header card at the top of S13 (corrected/s13_booking_detail.html) swaps per booking status. Everything below the header stays as in S13. Professionals see the mirror copy (e.g. requested → "Accept / Decline", in_progress → "Mark delivered").</p>{cards}</main>'''
    return page("Booking status variants", body, note="S13b: statuses from api — pending_payment, requested, accepted, in_progress, delivered, completed, cancelled, declined, disputed, refunded.")

# ───────────────────────────────────────────── S14 AI empty state
def s14_empty():
    prompts = "".join(f'<button class="shrink-0 h-10 px-4 rounded-full bg-surface-container-lowest border border-outline-variant font-label-lg text-label-lg text-on-surface">{p}</button>'
                      for p in ["How much to rewire a 3-bed flat?", "Fair price for AC servicing in Ikeja", "What should a plumber quote include?"])
    body = f'''{topbar("Servix AI", right=f'<button class="w-10 h-10 rounded-full flex items-center justify-center" aria-label="More">{ic("more_vert")}</button>')}
<main class="flex-1 flex flex-col pb-safe">
<div class="flex-1 flex flex-col items-center justify-center text-center px-10">
<span class="w-16 h-16 rounded-full bg-primary text-on-primary flex items-center justify-center">{ic("auto_awesome", 30, True)}</span>
<span class="font-headline-md text-headline-md mt-5">Ask Servix AI</span>
<p class="font-body-md text-body-md text-on-surface-variant mt-2">Describe the job and get a fair price range, what the scope should include and which professional fits.</p>
<span class="font-label-md text-label-md text-on-surface-variant mt-4">18 / 25 questions left this month · Plus plan</span></div>
<div class="flex gap-2 overflow-x-auto px-gutter pb-3 [scrollbar-width:none]">{prompts}</div>
<div class="px-gutter pb-4"><div class="h-[52px] rounded-full border border-outline bg-surface-container-lowest flex items-center pl-5 pr-1.5 gap-2"><input class="flex-1 bg-transparent outline-none font-body-lg text-body-lg" placeholder="Ask Servix AI…"/><button class="w-10 h-10 rounded-full bg-primary text-on-primary flex items-center justify-center" aria-label="Send">{ic("arrow_upward", 20)}</button></div>
<p class="font-body-sm text-body-sm text-on-surface-variant text-center mt-2">Servix AI can make mistakes. Confirm prices with the professional.</p></div>
<!-- DISABLED STATE: when GET ai/usage → enabled:false, replace the composer with a card "Servix AI is not available on your plan" + "Manage plan" -->
</main>'''
    return page("Servix AI — empty", body, note="S14b: first-open state of the AI thread; streaming via POST ai/assistant/stream; usage from GET ai/usage.")

# ───────────────────────────────────────────── S19 contact card
def s19():
    def row(icon, t, s_): return f'<li class="flex items-center gap-3 px-4 min-h-[56px] border-b border-outline-variant last:border-0">{ic(icon, 22)}<span class="flex-1"><span class="block font-title-md text-title-md font-medium">{t}</span><span class="block font-body-sm text-body-sm text-on-surface-variant">{s_}</span></span>{ic("chevron_right", 22)}</li>'
    body = f'''{topbar("Contact")}
<main class="flex-1 pb-safe">
<div class="flex flex-col items-center pt-6 pb-4 px-gutter">{avatar("BA", 24, "text-headline-lg")}<span class="font-headline-md text-headline-md mt-4 flex items-center gap-1">Bayo Alabi {ic("verified", 20, True).replace("material-symbols-outlined", "material-symbols-outlined text-primary")}</span>
<span class="font-body-md text-body-md text-on-surface-variant">Electrician · Ikeja, Lagos</span><span class="font-body-sm text-body-sm text-on-surface-variant mt-1">Online</span>
<div class="grid grid-cols-2 gap-2 mt-5 w-full">{primary_btn("Message", "chat_bubble", "min-h-[44px]")}{secondary_btn("View profile", "person", "min-h-[44px]")}</div></div>
<div class="px-gutter mt-2"><ul class="rounded-2xl bg-surface-container-lowest border border-outline-variant overflow-hidden">
{row("photo_library", "Media, files and voice notes", "12 items")}{row("event", "Bookings together", "2 bookings")}{row("notifications_off", "Mute notifications", "Off")}</ul></div>
<div class="px-gutter mt-6"><ul class="rounded-2xl bg-surface-container-lowest border border-outline-variant overflow-hidden text-error">
<li class="flex items-center gap-3 px-4 min-h-[56px] border-b border-outline-variant">{ic("block", 22)}<span class="font-title-md text-title-md font-medium">Block Bayo Alabi</span></li>
<li class="flex items-center gap-3 px-4 min-h-[56px]">{ic("flag", 22)}<span class="font-title-md text-title-md font-medium">Report</span></li></ul></div>
<p class="px-gutter mt-4 font-body-sm text-body-sm text-on-surface-variant">Phone numbers are not shared. All contact happens inside Servix.</p>
</main>'''
    return page("Contact card", body, note="S19 (Release 1.1): opened from the conversation header. No phone/video calls — chat only.")

def main():
    files = {"s1_splash.html": s1(), **s6_all(), "s8b_home_guest.html": s8_guest(), "s8c_home_professional.html": s8_pro(),
             "s15_notifications.html": s15(), "s16_account.html": s16(), "s13b_booking_status_variants.html": s13_states(),
             "s14b_servix_ai_empty.html": s14_empty(), "s19_contact_card.html": s19()}
    for n, h in files.items():
        (OUT / n).write_text(h, encoding="utf-8"); print("wrote", n, len(h))

if __name__ == "__main__":
    main()
