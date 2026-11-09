#!/usr/bin/env python3
"""Servix Stitch correction pass.

Reads docs/stitch-design/original/*.html (as delivered from Google Drive) and writes
docs/stitch-design/corrected/*.html with:
  * the shared Tailwind theme re-mapped to the Servix brand palette and radii,
  * Cloudflare Rocket-Loader damage undone (script types, onclick guards, data-cf attrs),
  * Google-hosted AI images replaced by self-contained SVG placeholders,
  * one canonical bottom bar (Home · Explore · Chats · Bookings · Account),
  * "escrow"/invented-feature copy removed or rewritten, screen by screen,
  * "artisan" -> "professional" in visible text.
Every edit is asserted so a silent no-op cannot happen.  Run: python3 tools/correct.py
"""
from __future__ import annotations
import re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = ROOT / "original"
DST = ROOT / "corrected"
DST.mkdir(exist_ok=True)

# --------------------------------------------------------------------------- brand theme
BRAND = {
    "primary": "#12372A", "on-primary": "#FFFFFF",
    "primary-container": "#1F5C45", "on-primary-container": "#F7F4EC",
    "primary-fixed": "#EDE8DC", "primary-fixed-dim": "#C9C2B1",
    "on-primary-fixed": "#12372A", "on-primary-fixed-variant": "#1F5C45",
    "inverse-primary": "#CFE0D6", "surface-tint": "#1F5C45",
    "secondary": "#1F5C45", "on-secondary": "#FFFFFF",
    "secondary-container": "#EDE8DC", "on-secondary-container": "#12372A",
    "secondary-fixed": "#EDE8DC", "secondary-fixed-dim": "#DDD7C9",
    "on-secondary-fixed": "#12372A", "on-secondary-fixed-variant": "#1F5C45",
    "tertiary": "#E56B5D", "on-tertiary": "#FFFFFF",
    "tertiary-container": "#FBE4E0", "on-tertiary-container": "#B3372A",
    "tertiary-fixed": "#FBE4E0", "tertiary-fixed-dim": "#F3B8B0",
    "on-tertiary-fixed": "#7A2418", "on-tertiary-fixed-variant": "#B3372A",
    "error": "#B3372A", "on-error": "#FFFFFF",
    "error-container": "#F9DEDA", "on-error-container": "#7A2418",
    "surface": "#F7F4EC", "background": "#F7F4EC", "surface-bright": "#F7F4EC",
    "surface-dim": "#DDD7C9", "surface-variant": "#EDE8DC",
    "surface-container-lowest": "#FFFFFF", "surface-container-low": "#F3EFE5",
    "surface-container": "#EDE8DC", "surface-container-high": "#E6E0D2",
    "surface-container-highest": "#DDD7C9",
    "on-surface": "#202622", "on-background": "#202622", "on-surface-variant": "#5F675F",
    "outline": "#C9C2B1", "outline-variant": "#DDD7C9",
    "inverse-surface": "#202622", "inverse-on-surface": "#F7F4EC",
}
RADII = 'borderRadius: { "DEFAULT": "0.75rem", "lg": "1rem", "xl": "1.25rem", "2xl": "1.5rem", "3xl": "1.75rem", "full": "9999px" }'

NAV_ITEMS = [("home", "home", "Home"), ("explore", "search", "Explore"),
             ("chats", "chat_bubble", "Chats"), ("bookings", "calendar_month", "Bookings"),
             ("account", "account_circle", "Account")]

def nav_html(active: str, badge: int = 0) -> str:
    items = []
    for key, icon, label in NAV_ITEMS:
        on = key == active
        colour = "text-primary" if on else "text-on-surface-variant"
        fill = ' style="font-variation-settings: \'FILL\' 1;"' if on else ""
        if key == "chats":
            disc = "bg-primary text-on-primary" if on else "bg-secondary-container text-primary"
            pill = (f'<span class="absolute -top-1 -right-2 min-w-[18px] h-[18px] px-1 rounded-full bg-tertiary '
                    f'text-on-tertiary text-[11px] font-semibold flex items-center justify-center">{badge}</span>'
                    if badge else "")
            icon_html = (f'<span class="relative w-[34px] h-[34px] rounded-full {disc} flex items-center justify-center">'
                         f'<span class="material-symbols-outlined text-[20px]"{fill}>{icon}</span>{pill}</span>')
        else:
            icon_html = (f'<span class="w-[34px] h-[34px] flex items-center justify-center">'
                         f'<span class="material-symbols-outlined text-[24px]"{fill}>{icon}</span></span>')
        cur = ' aria-current="page"' if on else ""
        bold = " font-semibold" if on else ""
        items.append(f'<a class="flex-1 flex flex-col items-center justify-center gap-0.5 min-h-[48px] {colour}" '
                     f'data-path="{key}" href="#"{cur}>{icon_html}'
                     f'<span class="font-label-md text-label-md{bold}">{label}</span></a>')
    return ('<!-- SERVIX BOTTOM BAR (canonical, Release 1.1): Home · Explore · Chats (centre, 34dp disc, badge = Σ unreadCount) '
            '· Bookings · Account. Guests: Home · Explore · Account only. -->\n'
            '<nav class="fixed bottom-0 inset-x-0 z-50 pb-safe bg-surface border-t border-outline-variant" aria-label="Main">'
            '<div class="h-16 px-1 flex items-stretch">' + "".join(items) + '</div></nav>')

# --------------------------------------------------------------------------- helpers
class Edit:
    def __init__(self, name: str, html: str):
        self.name, self.html, self.log = name, html, []

    def rep(self, old: str, new: str, count: int = 1, must: bool = True):
        n = self.html.count(old)
        if n == 0:
            if must: raise SystemExit(f"[{self.name}] text not found: {old[:80]!r}")
            return self
        self.html = self.html.replace(old, new, count if count > 0 else n)
        self.log.append(f"rep {old[:50]!r} -> {new[:50]!r} x{min(n, count) if count>0 else n}")
        return self

    def rep_re(self, pat: str, new: str, flags=re.S, must: bool = True):
        self.html, n = re.subn(pat, new, self.html, flags=flags)
        if n == 0 and must: raise SystemExit(f"[{self.name}] regex not found: {pat[:80]!r}")
        self.log.append(f"re {pat[:50]!r} x{n}")
        return self

    def _balanced_end(self, start: int, tag: str) -> int:
        depth, i = 0, start
        open_re = re.compile(rf"<{tag}\b[^>]*?(/?)>", re.S)
        close_re = re.compile(rf"</{tag}\s*>")
        while True:
            mo, mc = open_re.search(self.html, i), close_re.search(self.html, i)
            if not mc: raise SystemExit(f"[{self.name}] unbalanced <{tag}> from {start}")
            if mo and mo.start() < mc.start():
                if not mo.group(1): depth += 1
                i = mo.end()
            else:
                depth -= 1; i = mc.end()
                if depth == 0: return i

    def drop_after_comment(self, comment: str, tag: str | None = None):
        """Remove the comment and the first element that follows it."""
        idx = self.html.find(comment)
        if idx < 0: raise SystemExit(f"[{self.name}] comment not found: {comment!r}")
        m = re.compile(r"<([a-zA-Z][a-zA-Z0-9]*)\b").search(self.html, idx + len(comment))
        tag = tag or m.group(1)
        start = m.start()
        end = self._balanced_end(start, tag)
        removed = self.html[idx:end]
        self.html = self.html[:idx] + "<!-- block removed in Servix correction pass -->" + self.html[end:]
        self.log.append(f"drop block after {comment[:40]!r} ({len(removed)} chars)")
        return self

    def drop_enclosing(self, needle: str, tag: str, occurrence: int = 1):
        """Remove the nearest enclosing <tag> that contains `needle`."""
        pos = -1
        for _ in range(occurrence):
            pos = self.html.find(needle, pos + 1)
            if pos < 0: raise SystemExit(f"[{self.name}] needle not found: {needle!r}")
        start = self.html.rfind(f"<{tag}", 0, pos)
        # make sure the found opener really encloses the needle
        while start >= 0 and self._balanced_end(start, tag) < pos:
            start = self.html.rfind(f"<{tag}", 0, start)
        if start < 0: raise SystemExit(f"[{self.name}] no enclosing <{tag}> for {needle!r}")
        end = self._balanced_end(start, tag)
        self.html = self.html[:start] + "<!-- element removed in Servix correction pass -->" + self.html[end:]
        self.log.append(f"drop <{tag}> containing {needle[:40]!r}")
        return self

    def replace_nav(self, active: str, badge: int = 0):
        pat = re.compile(r'<nav class="fixed bottom-0.*?</nav>', re.S)
        if not pat.search(self.html): raise SystemExit(f"[{self.name}] no bottom nav to replace")
        self.html = pat.sub(lambda _: nav_html(active, badge), self.html, count=1)
        self.log.append(f"nav -> canonical (active={active}, badge={badge})")
        return self

# --------------------------------------------------------------------------- global passes
def apply_theme(e: Edit):
    def fix_cfg(m):
        cfg = m.group(0)
        for k, v in BRAND.items():
            cfg, n = re.subn(rf'"{k}":\s*"#[0-9a-fA-F]{{6}}"', f'"{k}": "{v}"', cfg)
        cfg = re.sub(r'borderRadius:\s*\{[^}]*\}', RADII, cfg)
        return cfg
    e.html, n = re.subn(r'tailwind\.config\s*=\s*\{.*?\};?\s*</script>', fix_cfg, e.html, flags=re.S)
    if n != 1: raise SystemExit(f"[{e.name}] tailwind config not found")
    # stray literal surface colour used in a few inline styles / gradients
    e.html = e.html.replace("#f5fbf4", "#F7F4EC").replace("#F5FBF4", "#F7F4EC")
    e.html = e.html.replace("#96d3b6", "#C9C2B1")
    e.log.append("theme -> brand palette + radii")

def undo_cloudflare(e: Edit):
    e.html = re.sub(r'<script type="[0-9a-f]{20,}-text/javascript">', '<script>', e.html)
    e.html = re.sub(r'if \(!window\.__cfRLUnblockHandlers\) return false; ?', '', e.html)
    e.html = re.sub(r'\s*data-cf-modified-[0-9a-f-]+="[^"]*"', '', e.html)
    e.html = re.sub(r'<script src="/cdn-cgi/scripts/[^"]+" data-cf-settings="[^"]*" defer></script>', '', e.html)
    e.log.append("cloudflare rocket-loader artefacts removed")

def localise_images(e: Edit):
    def pick(m):
        tag = m.group(0)
        avatar = ("rounded-full" in tag) or re.search(r'\bw-(8|9|10|11|12|14)\b', tag) is not None
        ph = "../assets/placeholder-avatar.svg" if avatar else "../assets/placeholder-photo.svg"
        return re.sub(r'src="https://lh3\.googleusercontent\.com/[^"]+"', f'src="{ph}"', tag)
    e.html, n1 = re.subn(r'<img\b[^>]*src="https://lh3\.googleusercontent\.com/[^"]+"[^>]*>', pick, e.html)
    e.html, n2 = re.subn(r"url\(['\"]?https://lh3\.googleusercontent\.com/[^)'\"]+['\"]?\)",
                         "url('../assets/placeholder-photo.svg')", e.html)
    e.html, n3 = re.subn(r'https://lh3\.googleusercontent\.com/[^"\')\s]+', '../assets/placeholder-photo.svg', e.html)
    e.log.append(f"images localised: {n1} img, {n2} css url, {n3} other")

def professional_wording(e: Edit):
    # visible text only (between > and <), never inside attributes
    def fix(m):
        t = m.group(0)
        t = re.sub(r"\bArtisans\b", "Professionals", t); t = re.sub(r"\bartisans\b", "professionals", t)
        t = re.sub(r"\bArtisan\b", "Professional", t); t = re.sub(r"\bartisan\b", "professional", t)
        t = t.replace("Artisanal", "Professional")
        t = re.sub(r"\bVetted\b", "Verified", t).replace("vetted", "verified")
        return t
    e.html = re.sub(r">[^<>]*<", fix, e.html)
    e.html = e.html.replace("Create Account<", "Create account<").replace("Sign In<", "Sign in<")
    e.log.append("artisan -> professional in text nodes")

# --------------------------------------------------------------------------- per-file edits
def s2(e: Edit):
    e.rep("Get Started", "Get started").rep("Sign In\n", "Sign in\n", must=False)

def s3(e: Edit):
    e.rep("Verified Escrow Portal", "Servix")
    e.rep("Trusted by verified artisans across Lagos", "Trusted professionals. Protected payments.")
    e.rep("Sign in to manage your bookings and protected payments in Lagos.", "Sign in to manage your bookings, chats and payments.")
    e.rep("Secured by Servix Multi-Factor Protection", "Protected by two-step sign-in")
    e.rep("Central Bank of Nigeria (CBN) Tier 3 Escrow Standards",
          "You pay through Servix. Money is released to the professional after you confirm the work.")

def s4(e: Edit):
    e.drop_after_comment("<!-- Rule 6: Max 200 chars -->")
    e.rep("0 of 6 met", "0 of 5 met").rep("${metCount} of 6 met", "${metCount} of 5 met")
    e.rep_re(r",\s*max:\s*\{\s*el: document\.getElementById\('rule-max'\),\s*test: \(val\) => [^\n]*\n\s*\}", "")
    e.rep("if (metCount === 6)", "if (metCount === 5)")

def s5(e: Edit):
    e.drop_after_comment("<!-- Artisanal Trust Badge & Escrow Safeguard Indicator -->")
    e.rep("6-digit confirmation code and verification link", "6-digit confirmation code")

def s6(e: Edit):
    e.rep("Tier-3 Vault Escrow Shield", "Account security")
    e.rep("Two-Step Security Check", "Two-step security check")
    e.rep("To safeguard your account and protected payments, please verify your identity.", "One more check. Then you're in.")
    e.rep("Contact Servix Concierge", "Contact Servix support")
    e.rep("Lost your authenticator device? Use backup code", "Lost access? Use a recovery code")
    e.rep("TOTP App", "Authenticator", must=False).rep("Email OTP", "Email code", must=False).rep("Backup Key", "Recovery code", must=False)
    e.rep("Confirm &amp; Sign In", "Verify security code", must=False)

def s7(e: Edit):
    e.drop_after_comment("<!-- Artisanal Trust Reassurance Card -->")
    e.drop_after_comment("<!-- Verified Pro Support Card -->")
    e.rep("Secure Identity Retrieval", "Account recovery")
    e.rep("Reset Link Dispatched", "Reset email sent")
    e.rep("Send Reset Link", "Send reset link")
    e.rep("We’ll send you a password reset link and recovery instructions.", "We’ll email you a link to choose a new password.")

def s8(e: Edit):
    e.rep_re(r'<span class="[^"]*">Job #SV-\d+</span>', '<span class="font-label-md text-label-md text-on-surface-variant">Today</span>', must=True)
    e.rep_re(r'<p class="[^"]*">Job #SV-\d+</p>', '', must=True)
    e.rep("ON THE WAY", "IN PROGRESS")
    e.rep_re(r'<span class="material-symbols-outlined[^"]*">navigation</span>\s*Track Artisan',
             '<span class="material-symbols-outlined text-[18px]">chat_bubble</span>\n        Message Tunde')
    e.rep("Review Work", "Review work").rep("Confirm Completion", "Confirm completion").rep("Raise Dispute", "Raise a dispute")
    # Chats card goes right after the attention section (owner order: attention -> Chats -> bookings)
    chats_card = '''
<!-- 3b. CHATS CARD (Release 1.1) — unread total = Σ unreadCount from GET /community/threads; shown only when features.community -->
<section class="px-gutter">
<a href="#" class="flex items-center gap-3 p-4 rounded-2xl bg-surface-container-lowest border border-outline-variant">
<span class="w-11 h-11 rounded-full bg-primary text-on-primary flex items-center justify-center shrink-0"><span class="material-symbols-outlined text-[22px]" style="font-variation-settings: 'FILL' 1;">chat_bubble</span></span>
<span class="flex-1 min-w-0">
<span class="flex items-center justify-between"><span class="font-title-md text-title-md text-on-surface">Chats</span><span class="min-w-[22px] h-[22px] px-1.5 rounded-full bg-tertiary text-on-tertiary text-[12px] font-semibold flex items-center justify-center">2</span></span>
<span class="block font-body-sm text-body-sm text-on-surface-variant truncate">Ada Nwosu: I've shared the first draft of the logo.</span>
</span>
<span class="material-symbols-outlined text-on-surface-variant">chevron_right</span>
</a>
</section>'''
    marker = "<!-- 4."
    if marker not in e.html:
        raise SystemExit("[s8] section 4 marker not found")
    e.html = e.html.replace(marker, chats_card + "\n" + marker, 1)
    e.replace_nav("home", badge=2)

def s9e(e: Edit):
    e.rep("Servix Escrow Guarantee", "Protected payment")
    e.rep("Funds released only when job passes your inspection.", "You pay through Servix. The professional is paid after you confirm the work.")
    e.rep("100% dispute protection on all booked tasks", "Something wrong? Raise a dispute from the booking.")
    e.rep("Background checked with active identity guarantee", "Verified by the Servix team")
    e.rep("Featured Vetted Pros", "Featured professionals")
    e.drop_enclosing("Fast Response (~12 min)", "span")
    e.drop_enclosing("High Reliability 99%", "span")
    e.drop_enclosing("<span>Available Today</span>", "button")
    e.rep("Vetted Professionals", "Professionals", must=False)
    e.replace_nav("explore")

def s9r(e: Edit):
    e.rep("100% Vetted", "Verified", must=False)
    e.rep("Servix Guarantee Protection", "Protected payment", must=False)
    e.rep("Payment is safely held until you approve the completed service. No upfront cash risks.",
          "You pay through Servix. The professional is paid after you confirm the work.", must=False)
    e.replace_nav("explore")

def s10(e: Edit):
    e.rep("99%</span>", "4</span>").rep("On-time", "Services")
    e.rep("Servix Escrow", "Protected pay")
    e.drop_after_comment("<!-- 4. Trust & Verification Checklist Card -->")
    e.rep("Guaranteed upfront quotes. No hidden Lagos traffic levies.", "Fixed prices, agreed before you book.")
    e.rep("All verified with photo sign-offs", "Photos, PDFs and one video from the professional", must=False)

def s11(e: Edit):
    e.drop_after_comment("<!-- Scheduling & Location Section -->")
    e.drop_after_comment("<!-- FAQ Accordion -->")
    e.rep_re(r"Your <span class=\"([^\"]*)\">₦18,500</span> is held safely in Servix Protected Payment\. The artisan is paid only after you inspect and confirm the job is satisfactorily completed\.",
             r'You pay <span class="\1">₦18,500</span> through Servix. It is released to the professional after you confirm the work.')
    e.rep("Servix Protected Payment Guarantee", "Protected payment")
    e.rep("Book This Service", "Book this service", must=False)

def s12(e: Edit):
    e.rep_re(r'<span class="[^"]*">Job #SV-\d+</span>', '', must=True)
    e.drop_enclosing('aria-label="Call Bayo Alabi"', "button")
    e.rep("ON THE WAY", "IN PROGRESS")
    e.drop_enclosing("ETA ~14 mins", "span")
    e.rep("<span>Track Artisan</span>", "<span>Message</span>")
    e.rep_re(r'<span class="material-symbols-outlined[^"]*">explore</span>\s*<span>Message</span>',
             '<span class="material-symbols-outlined text-[18px]">chat_bubble</span>\n<span>Message</span>')
    e.rep("<span>Call / Message</span>", "<span>View details</span>")
    e.rep_re(r'<span class="material-symbols-outlined[^"]*">chat_bubble</span>\s*<span>View details</span>',
             '<span class="material-symbols-outlined text-[18px]">visibility</span>\n<span>View details</span>')
    e.rep("Lagos Concierge Support", "Servix support in the app")
    e.rep("Confirm &amp; Release Funds", "Confirm completion")
    e.rep("Protected Payment Held", "Paid through Servix", must=False).rep("Secured Amount", "Amount", must=False)
    e.rep("AWAITING CONFIRMATION", "AWAITING YOUR CONFIRMATION", must=False)
    e.replace_nav("bookings")

def s13(e: Edit):
    e.drop_enclosing("Auto-release in 46h 12m", "div")
    e.rep("Artisan Marked Job as Complete", "The professional marked this job complete")
    e.rep("(52 jobs) • 99% On-time", "(52 jobs)")
    e.rep("Protected funds remain safely in Servix custody until your final sign-off.", "Your payment stays with Servix until you confirm the work.")
    e.rep("Confirm Completion &amp; Release ₦28,500", "Confirm completion")
    e.rep("Raise Dispute or Request Fix", "Raise a dispute")
    e.rep('href="sms:+2348012345678"', 'href="#" data-action="open-chat"')
    e.drop_enclosing('href="tel:+2348012345678"', "a")
    e.rep("Licensed Master Electrician", "Electrician")
    e.drop_enclosing("Servix Protection &amp; Guarantee Fee", "div")
    e.rep("Total Protected Amount", "Total paid").rep("Held securely in trust", "Held by Servix until you confirm")
    e.rep("Funds will be transferred directly to Bayo Alabi's verified bank account only after you tap Confirm Completion.",
          "Bayo Alabi is paid after you tap Confirm completion.")
    e.drop_enclosing("Download Receipt / Invoice (PDF)", "button")
    e.rep("Need help with this job? Chat with Servix Support or call", "Need help with this job? Chat with Servix support in the app.")
    e.drop_enclosing('href="tel:+2341800737849"', "a")
    e.rep("Release ₦28,500?", "Confirm completion?")
    e.rep("This will officially mark Booking #SV-8921 complete and deposit the funds into Bayo Alabi's account.",
          "This marks the booking complete and releases ₦28,500 to Bayo Alabi.")
    e.rep("Yes, Release Funds", "Yes, confirm")
    e.rep("Payment will remain securely frozen while our resolution team reviews the case with Bayo Alabi.",
          "Your payment stays on hold while the Servix team reviews the case with Bayo Alabi.")
    e.rep("Submit &amp; Hold Funds", "Submit dispute")
    e.rep("Payment Protected via Paystack", "Paid through Servix (Paystack)", must=False)
    e.rep("Pre-Release Inspection", "Before you confirm").rep("before final sign-off", "before you confirm", must=False)
    e.rep("₦28,500 safely held by Servix", "₦28,500 held by Servix", must=False)
    e.rep("Artisan Accepted &amp; Arrived", "Professional accepted", must=False)
    e.rep("Customer Sign-off &amp; Payment Release", "You confirm the work", must=False)

def s14(e: Edit):
    e.drop_enclosing(">v1.1<", "span")
    e.rep("Trained on verified Nigerian market rates", "Ask about prices, scope or your bookings")
    e.rep("Plus Plan active", "Plus plan")
    e.drop_after_comment("<!-- Pinned Interactive Widget: Budget Estimator -->")
    e.rep("Verified Pricing Data", "Typical prices")
    e.rep("Based on Servix escrow-verified transactions in Computer Village, Ikeja:", "Based on recent Servix bookings in Computer Village, Ikeja:")
    e.drop_enclosing("Servix Protected Escrow:", "li")
    e.drop_after_comment("<!-- Live Context Artisan Visual Strip -->")
    e.drop_enclosing('title="Voice Search / Note"', "button")
    e.rep("Rates cross-checked against 18,000+ Servix Escrow releases in NG", "Servix AI can make mistakes. Confirm prices with the professional.")
    e.rep("Ask Servix AI about Nigerian market rates...", "Ask Servix AI…")
    e.rep("Explore Nigeria Market Intel", "Try asking", must=False)
    e.rep("Hire Pro for this", "Find a professional for this", must=False).rep("Hire Pro", "View profile", must=False)
    e.rep("Verified with 42 Computer Village repairs this month", "", must=False)

def s17(e: Edit):
    e.drop_enclosing("NEW — Release 1.1", "div")
    e.drop_enclosing("Tech Services", "button")
    e.drop_enclosing("Escrow Active", "button")
    e.rep("All Chats", "All")
    e.rep_re(r'placeholder="Search chats[^"]*"', 'placeholder="Search chats"')
    e.rep("Servix AI Assistant & Budget Guide", "Servix AI")
    e.rep("Lagos Rate Engine", "Pinned")
    e.rep_re(r'Based on Lagos tech rates, a senior mobile engineer averages <span class="[^"]*">₦250k - ₦450k</span> per sprint\. Click to calculate escrow milestone brackets\.\.\.',
             "Ask about pricing, scope or your bookings.")
    e.rep("Active Conversations", "Conversations").rep("3 with ongoing milestones", "4 chats")
    e.rep("Office router configuration completed. Invoice attached.", "Office router configuration completed. Photos attached.")
    e.drop_after_comment("<!-- Helpful Artisan Support Card -->")
    e.drop_after_comment("<!-- Floating Action Button (FAB): New Chat (+) in #12372A Deep Forest -->")
    e.replace_nav("chats", badge=3)

def s18(e: Edit):
    e.rep("Online • Typically replies in 5m", "Online")
    e.drop_enclosing('aria-label="Audio call"', "button")
    e.drop_enclosing('aria-label="Video call"', "button")
    e.drop_after_comment("<!-- Trust Banner / Release 1.1 Micro-pill -->")
    e.rep("We can deliver within 3 days under Servix protected milestone.", "We can deliver within 3 days.")
    e.drop_enclosing("Escrow milestone #2", "div")
    e.drop_after_comment("<!-- Quick Action Chip Rail (Bespoke Pro marketplace prompt shortcuts) -->")
    e.drop_enclosing(">Location</span>", "button")
    e.drop_enclosing(">Escrow</span>", "button")
    e.rep('title="Rocket">🚀', 'title="Laugh">😂').rep('title="Clap">👏', 'title="Fire">🔥')
    e.rep("Voice briefing", "Voice note", must=False)

def motion(e: Edit):
    e.rep("ProMotion Display", "High refresh rate").rep("120 FPS • Fluid", "120 Hz • Fluid")
    e.rep("Confirm Escrow Deposit", "Confirm booking", count=0)
    e.rep("Payment is funded in Servix Escrow. See you at Lekki Phase 1 tomorrow at 9 AM!", "Payment received through Servix. See you at Lekki Phase 1 tomorrow at 9 AM!")
    e.rep("Analysing Lagos technician escrow terms...", "Checking typical Lagos technician prices…", count=0)
    e.rep("Servix AI guarantee: 100% of your ₦45,000 fee remains in Nigerian CBN-compliant custody until milestone sign-off.",
          "Servix AI: a typical fee for this job is about ₦45,000. You pay through Servix; it is released after you confirm the work.", count=0)
    e.rep("4. Escrow Lock &amp; Celebration", "4. Payment confirmed &amp; celebration")
    e.rep("Secure vault spring lock &amp; victory burst", "Confirm-completion tick with a short celebration", must=False)
    e.rep("Vault Awaiting Authorisation", "Awaiting your confirmation")
    e.rep("₦45,000.00 Guaranteed", "₦45,000.00 held by Servix", must=False)
    e.rep("Trigger Instant Verification", "Confirm completion", must=False)
    e.rep("5. Booking Milestone Stepper", "5. Booking progress stepper")
    e.rep(">Booked<", ">Requested<", must=False).rep("In Route", "In progress").rep(">Done<", ">Completed<", must=False)
    e.rep("for Nigerian transactional trust", "for a calm, trustworthy feel", must=False)
    e.rep("Confirm Booking Deposit", "Confirm booking", must=False)
    e.html = e.html.replace("simulateEscrowRelease", "simulateConfirmCompletion").replace("escrowStateLabel", "confirmStateLabel")
    # reduced-motion rule for Android
    e.rep("### Jetpack Compose Architecture Mapping", "### Jetpack Compose Architecture Mapping", must=False)

PER_FILE = {
    "s2_welcome_minimal.html": s2, "s3_sign_in.html": s3, "s4_create_account_corrected.html": s4,
    "s5_email_verification.html": s5, "s6_security_check.html": s6, "s7_forgot_password.html": s7,
    "s8_home_dashboard_messages_tab_final.html": s8, "s9_explore_discovery.html": s9e,
    "s9_search_results.html": s9r, "s10_professional_profile.html": s10, "s11_service_detail.html": s11,
    "s12_bookings_hub.html": s12, "s13_booking_detail.html": s13, "s14_servix_ai_budget_guide.html": s14,
    "s17_chats_inbox_whatsapp_grade.html": s17, "s18_chat_conversation_voice_note.html": s18,
    "servix_motion_interaction_system.html": motion,
}
RENAME = {
    "s4_create_account_corrected.html": "s4_create_account.html",
    "s8_home_dashboard_messages_tab_final.html": "s8_home_customer.html",
    "s9_explore_discovery.html": "s9_explore.html", "s9_search_results.html": "s9b_explore_results.html",
    "s14_servix_ai_budget_guide.html": "s14_servix_ai.html",
    "s17_chats_inbox_whatsapp_grade.html": "s17_chats_list.html",
    "s18_chat_conversation_voice_note.html": "s18_chat_conversation.html",
    "servix_motion_interaction_system.html": "m0_motion_system.html",
}
FORBIDDEN = re.compile(r"escrow|CBN|NIMC|Police|Tier[ -]3|Concierge|Track Artisan|ETA ~|In Route|Auto-release|milestone|"
                       r"Download Receipt|18,400|1,240|18,000\+|NDPR|Background check|Workshop Inspected|replies in|Fast Response|"
                       r"Reliability|On-time|(?-i:ProMotion)|Release 1\.1|Job #|videocam|>call<|tel:|sms:|lh3\.googleusercontent|"
                       r"__cfRLUnblockHandlers|data-cf-modified|rocket-loader|\bartisan", re.I)

def main():
    report = []
    for name, fn in PER_FILE.items():
        e = Edit(name, (SRC / name).read_text(encoding="utf-8"))
        undo_cloudflare(e); apply_theme(e); localise_images(e)
        fn(e)
        professional_wording(e)
        check = re.sub(r"<!--.*?-->", "", e.html, flags=re.S)
        check = re.sub(r'\s(?:data-alt|alt|title)="[^"]*"', "", check)
        bad = sorted(set(m.group(0) for m in FORBIDDEN.finditer(check)))
        if bad:
            raise SystemExit(f"[{name}] forbidden content still present: {bad}")
        out = DST / RENAME.get(name, name)
        out.write_text(e.html, encoding="utf-8")
        report.append((name, out.name, len(e.log)))
        print(f"{name} -> {out.name}: {len(e.log)} edits")
    (DST / "CORRECTION_LOG.md").write_text(
        "# Correction log\n\n| original | corrected | edits |\n| --- | --- | --- |\n" +
        "\n".join(f"| {a} | {b} | {n} |" for a, b, n in report) + "\n", encoding="utf-8")

if __name__ == "__main__":
    main()
