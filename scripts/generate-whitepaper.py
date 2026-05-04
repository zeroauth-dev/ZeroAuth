#!/usr/bin/env python3
"""
ZeroAuth Technical White Paper Generator
Generates a professional 3-page PDF white paper.
"""

import os
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib.colors import HexColor
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, HRFlowable
)

# ── Brand Colors ──────────────────────────────────────────────
DARK_BG        = HexColor("#0a0f0d")
DARK_CARD      = HexColor("#111916")
DARK_SURFACE   = HexColor("#1a2420")
GREEN_PRIMARY  = HexColor("#2ecc71")
GREEN_DARK     = HexColor("#1a7a42")
GREEN_LIGHT    = HexColor("#a8f0c8")
TEXT_WHITE     = HexColor("#f0f5f2")
TEXT_GRAY      = HexColor("#8a9b92")
TEXT_MUTED     = HexColor("#5a6b62")
ACCENT_RED     = HexColor("#e74c3c")
ACCENT_ORANGE  = HexColor("#f39c12")
SEPARATOR      = HexColor("#2a3b32")
PLACEHOLDER_BG = HexColor("#1e2d26")
PLACEHOLDER_BR = HexColor("#3edc81")

OUTPUT_DIR  = os.path.dirname(os.path.abspath(__file__))
OUTPUT_PATH = os.path.join(os.path.dirname(OUTPUT_DIR), "ZeroAuth_WhitePaper.pdf")

W, H = letter
CONTENT_W = W - 72  # usable width with 36pt margins each side

# ── Styles ────────────────────────────────────────────────────
def S(name, **kw):
    defaults = {"fontName": "Helvetica", "fontSize": 8, "leading": 11,
                "textColor": TEXT_GRAY, "alignment": TA_LEFT, "spaceAfter": 0, "spaceBefore": 0}
    defaults.update(kw)
    return ParagraphStyle(name, **defaults)

ST = {
    "brand":        S("Brand", fontName="Helvetica-Bold", fontSize=12, textColor=TEXT_WHITE, spaceAfter=8),
    "title":        S("Title", fontName="Helvetica-Bold", fontSize=22, leading=26, textColor=TEXT_WHITE, spaceAfter=2),
    "title_green":  S("TitleGreen", fontName="Helvetica-Bold", fontSize=22, leading=26, textColor=GREEN_PRIMARY, spaceAfter=10),
    "subtitle":     S("Subtitle", fontSize=9, leading=13, textColor=TEXT_GRAY, spaceAfter=8),
    "sec_num":      S("SecNum", fontName="Helvetica-Bold", fontSize=7.5, textColor=GREEN_PRIMARY, spaceAfter=1),
    "sec_title":    S("SecTitle", fontName="Helvetica-Bold", fontSize=13, leading=16, textColor=TEXT_WHITE, spaceAfter=4),
    "subsec":       S("Subsec", fontName="Helvetica-Bold", fontSize=9, leading=12, textColor=GREEN_LIGHT, spaceBefore=5, spaceAfter=3),
    "body":         S("Body", fontSize=8, leading=11.5, textColor=TEXT_GRAY, alignment=TA_JUSTIFY, spaceAfter=3),
    "body_w":       S("BodyW", fontSize=8, leading=11.5, textColor=TEXT_WHITE, alignment=TA_JUSTIFY, spaceAfter=3),
    "callout":      S("Callout", fontName="Helvetica-Bold", fontSize=8, leading=11, textColor=GREEN_PRIMARY, leftIndent=8),
    "ph":           S("PH", fontName="Courier", fontSize=7, leading=10, textColor=ACCENT_ORANGE, leftIndent=6),
    "th":           S("TH", fontName="Helvetica-Bold", fontSize=7, leading=10, textColor=TEXT_WHITE, alignment=TA_CENTER),
    "tc":           S("TC", fontSize=7, leading=10, textColor=TEXT_GRAY, alignment=TA_CENTER),
    "tcl":          S("TCL", fontSize=7, leading=10, textColor=TEXT_GRAY, alignment=TA_LEFT),
    "tcg":          S("TCG", fontName="Helvetica-Bold", fontSize=7, leading=10, textColor=GREEN_PRIMARY, alignment=TA_CENTER),
    "tcr":          S("TCR", fontName="Helvetica-Bold", fontSize=7, leading=10, textColor=ACCENT_RED, alignment=TA_CENTER),
    "stat_val":     S("StatVal", fontName="Helvetica-Bold", fontSize=18, leading=22, textColor=ACCENT_RED, alignment=TA_CENTER),
    "stat_lbl":     S("StatLbl", fontSize=6.5, leading=9, textColor=TEXT_GRAY, alignment=TA_CENTER),
    "code":         S("Code", fontName="Courier", fontSize=6.5, leading=9, textColor=GREEN_LIGHT),
    "meta_k":       S("MetaK", fontName="Helvetica-Bold", fontSize=6, textColor=GREEN_PRIMARY),
    "meta_v":       S("MetaV", fontSize=8, textColor=TEXT_WHITE),
    "footer":       S("Footer", fontSize=6, textColor=TEXT_MUTED, alignment=TA_CENTER),
    "disclaimer":   S("Discl", fontName="Helvetica-Oblique", fontSize=6, leading=8, textColor=TEXT_MUTED, alignment=TA_CENTER),
}


# ── Dark Page Background ────────────────────────────────────
class DarkPageTemplate:
    def __init__(self):
        self.page_count = 0

    def on_page(self, c, doc):
        self.page_count += 1
        c.saveState()
        c.setFillColor(DARK_BG)
        c.rect(0, 0, W, H, fill=1, stroke=0)

        # Top green accent bar
        c.setFillColor(GREEN_PRIMARY)
        c.rect(0, H - 3, W, 3, fill=1, stroke=0)

        # Header
        c.setStrokeColor(SEPARATOR); c.setLineWidth(0.4)
        c.line(36, H - 34, W - 36, H - 34)
        c.setFont("Helvetica-Bold", 7); c.setFillColor(GREEN_PRIMARY)
        c.drawString(36, H - 30, "ZEROAUTH")
        c.setFont("Helvetica", 6); c.setFillColor(TEXT_MUTED)
        c.drawRightString(W - 36, H - 30, "TECHNICAL WHITE PAPER  |  CONFIDENTIAL")

        # Footer
        c.setStrokeColor(SEPARATOR)
        c.line(36, 32, W - 36, 32)
        c.setFont("Helvetica", 6); c.setFillColor(TEXT_MUTED)
        c.drawString(36, 22, "Patent Application No. 202311041001")
        c.drawCentredString(W / 2, 22, f"Page {self.page_count}")
        c.drawRightString(W - 36, 22, "zeroauth.io")

        # Left accent
        c.setStrokeColor(GREEN_PRIMARY); c.setLineWidth(1.5)
        c.line(26, H - 40, 26, 38)
        c.restoreState()

    def on_cover(self, c, doc):
        self.page_count += 1
        c.saveState()
        c.setFillColor(DARK_BG)
        c.rect(0, 0, W, H, fill=1, stroke=0)

        # Diagonal accent
        p = c.beginPath()
        p.moveTo(W * 0.6, H); p.lineTo(W, H); p.lineTo(W, H * 0.35); p.close()
        c.setFillColor(HexColor("#0d1a13")); c.drawPath(p, fill=1, stroke=0)

        # Top bar + left stripe
        c.setFillColor(GREEN_PRIMARY); c.rect(0, H - 4, W, 4, fill=1, stroke=0)
        c.setFillColor(GREEN_DARK); c.rect(0, 0, 5, H, fill=1, stroke=0)

        # Shield icon
        cx, cy = W - 100, H - 140
        p2 = c.beginPath()
        p2.moveTo(cx, cy + 28); p2.lineTo(cx - 22, cy + 16); p2.lineTo(cx - 22, cy - 4)
        p2.curveTo(cx - 22, cy - 20, cx, cy - 30, cx, cy - 30)
        p2.curveTo(cx, cy - 30, cx + 22, cy - 20, cx + 22, cy - 4)
        p2.lineTo(cx + 22, cy + 16); p2.close()
        c.setFillColor(GREEN_DARK); c.setStrokeColor(GREEN_PRIMARY); c.setLineWidth(1.2)
        c.drawPath(p2, fill=1, stroke=1)
        c.setLineWidth(2); c.line(cx - 8, cy - 4, cx - 2, cy - 11); c.line(cx - 2, cy - 11, cx + 10, cy + 6)

        # Footer
        c.setStrokeColor(SEPARATOR); c.setLineWidth(0.4)
        c.line(36, 40, W - 36, 40)
        c.setFont("Helvetica", 6); c.setFillColor(TEXT_MUTED)
        c.drawString(36, 28, "Patent Application No. 202311041001  |  Indian Patent Office")
        c.drawRightString(W - 36, 28, "Page 1")
        c.restoreState()


# ── Helpers ──────────────────────────────────────────────────
def sec(n, title):
    return [Paragraph(f"SECTION {n}", ST["sec_num"]),
            Paragraph(title, ST["sec_title"]),
            HRFlowable(width="35%", thickness=1.5, color=GREEN_PRIMARY, spaceAfter=4, hAlign="LEFT")]

def callout(text):
    t = Table([[Paragraph(text, ST["callout"])]], colWidths=[CONTENT_W])
    t.setStyle(TableStyle([("BACKGROUND", (0,0), (-1,-1), DARK_SURFACE),
        ("BOX", (0,0), (-1,-1), 1, GREEN_PRIMARY),
        ("LEFTPADDING", (0,0), (-1,-1), 10), ("RIGHTPADDING", (0,0), (-1,-1), 10),
        ("TOPPADDING", (0,0), (-1,-1), 6), ("BOTTOMPADDING", (0,0), (-1,-1), 6)]))
    return t

def ph_block(lines):
    content = "<br/>".join([f'<font color="#f39c12">>>> {l}</font>' for l in lines])
    t = Table([[Paragraph(content, ST["ph"])]], colWidths=[CONTENT_W])
    t.setStyle(TableStyle([("BACKGROUND", (0,0), (-1,-1), PLACEHOLDER_BG),
        ("BOX", (0,0), (-1,-1), 0.8, PLACEHOLDER_BR),
        ("LEFTPADDING", (0,0), (-1,-1), 8), ("RIGHTPADDING", (0,0), (-1,-1), 8),
        ("TOPPADDING", (0,0), (-1,-1), 5), ("BOTTOMPADDING", (0,0), (-1,-1), 5)]))
    return t

def stat_cell(val, lbl, color=ACCENT_RED):
    s = ParagraphStyle("sv", parent=ST["stat_val"], textColor=color)
    return Table([[Paragraph(val, s)], [Paragraph(lbl, ST["stat_lbl"])]],
        colWidths=[1.7*inch])

def hr():
    return HRFlowable(width="100%", thickness=0.5, color=GREEN_DARK, spaceAfter=4, spaceBefore=4)

def table_style_base():
    return [("BACKGROUND", (0,0), (-1,0), GREEN_DARK),
            ("BACKGROUND", (0,1), (-1,-1), DARK_CARD),
            ("BOX", (0,0), (-1,-1), 0.8, SEPARATOR),
            ("INNERGRID", (0,0), (-1,-1), 0.4, SEPARATOR),
            ("TOPPADDING", (0,0), (-1,-1), 3), ("BOTTOMPADDING", (0,0), (-1,-1), 3),
            ("LEFTPADDING", (0,0), (-1,-1), 4), ("RIGHTPADDING", (0,0), (-1,-1), 4),
            ("VALIGN", (0,0), (-1,-1), "MIDDLE")]

# ── PAGE 1: Cover + Section 1 ───────────────────────────────
def page1():
    s = []
    s.append(Spacer(1, 36))
    s.append(Paragraph('<font color="#2ecc71">Zero</font><font color="#f0f5f2">Auth</font>', ST["brand"]))
    s.append(Paragraph("Why Every Enterprise SSO Is A Breach Waiting To Happen", ST["title"]))
    s.append(Spacer(1, 3))
    s.append(Paragraph("And The Mathematical Proof That ZeroAuth Eliminates The Risk", ST["title_green"]))
    s.append(Spacer(1, 8))
    s.append(Paragraph(
        "A technical analysis of centralized identity vulnerabilities, zero-knowledge proof "
        "authentication, and the economic case for decentralized biometric verification anchored on-chain.", ST["subtitle"]))

    # Meta row
    md = [["CLASSIFICATION", "PATENT REF", "VERSION", "CHAIN"],
          ["Confidential", "202311041001", "2.0", "Base Sepolia L2"]]
    mt = Table(md, colWidths=[1.4*inch]*4)
    mt.setStyle(TableStyle([
        ("FONTNAME", (0,0), (-1,0), "Helvetica-Bold"), ("FONTSIZE", (0,0), (-1,0), 6),
        ("TEXTCOLOR", (0,0), (-1,0), GREEN_PRIMARY),
        ("FONTNAME", (0,1), (-1,1), "Helvetica"), ("FONTSIZE", (0,1), (-1,1), 8),
        ("TEXTCOLOR", (0,1), (-1,1), TEXT_WHITE),
        ("TOPPADDING", (0,0), (-1,-1), 2), ("BOTTOMPADDING", (0,0), (-1,-1), 2),
        ("LEFTPADDING", (0,0), (-1,-1), 0),
        ("LINEBELOW", (0,0), (-1,0), 0.4, SEPARATOR)]))
    s.append(mt)
    s.append(hr())

    # Section 1
    s.extend(sec("01", "The Okta 2023 Breach: What The Data Shows"))
    s.append(Paragraph(
        "In September 2023, the Okta breach exposed every enterprise relying on centralized identity "
        "providers. Threat actors accessed Okta's customer support system, extracting HAR files "
        "containing session tokens for downstream customers. The cascading impact was immediate:", ST["body"]))

    # Stats row
    sr = [[stat_cell("$100M+", "MGM Resorts Loss", ACCENT_RED),
           stat_cell("134", "Customers Exposed", ACCENT_ORANGE),
           stat_cell("10 Days", "Undetected Dwell", ACCENT_RED)]]
    st2 = Table(sr, colWidths=[1.8*inch]*3)
    st2.setStyle(TableStyle([("ALIGN",(0,0),(-1,-1),"CENTER"), ("VALIGN",(0,0),(-1,-1),"TOP"),
        ("LEFTPADDING",(0,0),(-1,-1),3), ("RIGHTPADDING",(0,0),(-1,-1),3)]))
    s.append(Spacer(1, 2))
    s.append(st2)
    s.append(Spacer(1, 4))

    s.append(Paragraph(
        "The fundamental vulnerability is <b>architectural</b>: every centralized SSO provider creates a "
        "single point of failure. When the identity provider is compromised, every downstream application "
        "is simultaneously breached. This is not a bug to be patched -- it is an inherent property "
        "of the centralized trust model.", ST["body"]))

    s.append(Spacer(1, 2))
    s.append(ph_block([
        "INSERT: Total number of Okta-related breaches in 2023-2024",
        "INSERT: Aggregate financial losses across all affected enterprises",
        "INSERT: Average breach detection time for SSO-related incidents",
        "INSERT: Number of user credentials exposed across all incidents"]))
    s.append(Spacer(1, 4))
    s.append(callout(
        '"The question is not IF your identity provider will be breached, but WHEN. '
        'The only defense is an architecture where there is nothing to steal."'))

    s.append(PageBreak())
    return s


# ── PAGE 2: Sections 2 + 3 ──────────────────────────────────
def page2():
    s = []

    # Section 2
    s.extend(sec("02", "Why Storing Biometric Templates Is An Uninsurable Risk"))
    s.append(Paragraph(
        "Unlike passwords, biometric identifiers -- fingerprints, facial geometry, iris patterns -- are "
        "<b>irrevocable</b>. A stolen password can be reset in seconds. A stolen biometric template "
        "cannot be reset ever. This creates a liability profile that insurance underwriters increasingly refuse to cover.", ST["body"]))

    s.append(Paragraph("The Irrevocability Problem", ST["subsec"]))

    # Risk table
    hdr = [Paragraph("FACTOR", ST["th"]), Paragraph("PASSWORDS", ST["th"]),
           Paragraph("BIOMETRIC TEMPLATES", ST["th"]), Paragraph("ZEROAUTH ZKP", ST["th"])]
    rows = [hdr]
    for r in [["Revocable after breach", "Yes", "No", "N/A (nothing stored)"],
              ["Lifetime exposure", "Until reset", "Permanent", "Zero"],
              ["Regulatory liability", "Moderate", "Severe (GDPR Art.9)", "None"],
              ["Insurance availability", "Standard", "Declining", "Full coverage"],
              ["Per-record breach cost", "$164 avg", "$380+ avg", "$0"],
              ["Attack surface", "Credential DB", "Template vault", "No server-side data"]]:
        rows.append([Paragraph(r[0], ST["tcl"]), Paragraph(r[1], ST["tc"]),
                     Paragraph(r[2], ST["tcr"]), Paragraph(r[3], ST["tcg"])])
    rt = Table(rows, colWidths=[1.5*inch, 1.1*inch, 1.5*inch, 1.5*inch])
    rt.setStyle(TableStyle(table_style_base()))
    s.append(rt)
    s.append(Spacer(1, 3))
    s.append(ph_block([
        "INSERT: Current cyber insurance premium increases for biometric data holders",
        "INSERT: Number of insurers excluding biometric breach coverage in 2024-2025",
        "INSERT: GDPR/BIPA fine amounts for biometric data breaches"]))

    s.append(Spacer(1, 2))
    s.append(hr())

    # Section 3
    s.extend(sec("03", "Zero-Knowledge Proof Architecture: How ZeroAuth Works"))
    s.append(Paragraph(
        "ZeroAuth implements Patent Application No. 202311041001, a system for decentralized identity "
        "management that mathematically guarantees the server never receives, processes, or stores "
        "biometric data. The protocol operates in four cryptographic phases:", ST["body"]))

    # Architecture modules - compact
    modules = [
        ("212", "Data Acquisition",
         "Client captures biometric locally. Raw data never leaves the device boundary."),
        ("214", "Identity Generation",
         "SHA-256(biometric) &rarr; biometricID &rarr; DID generation &rarr; Poseidon(secret, salt) &rarr; on-chain commitment."),
        ("216", "ZKP Generation",
         "Client generates Groth16 proof (BN128, 486 constraints). Proves knowledge of secret WITHOUT revealing it."),
        ("218", "Verification",
         "Server verifies via snarkjs (~10ms) or Solidity Verifier on-chain. Commitment anchored to Base Sepolia L2."),
    ]
    for num, title, desc in modules:
        row = [[Paragraph(f'<font color="#2ecc71"><b>M-{num}</b></font>', ST["sec_num"]),
                Paragraph(f'<b>{title}:</b> <font size="7" color="#8a9b92">{desc}</font>', ST["body"])]]
        ft = Table(row, colWidths=[0.55*inch, CONTENT_W - 0.55*inch])
        ft.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1), DARK_CARD),
            ("BOX",(0,0),(0,0), 0.8, GREEN_DARK),
            ("LEFTPADDING",(0,0),(-1,-1), 6), ("RIGHTPADDING",(0,0),(-1,-1), 6),
            ("TOPPADDING",(0,0),(-1,-1), 4), ("BOTTOMPADDING",(0,0),(-1,-1), 4),
            ("VALIGN",(0,0),(-1,-1),"TOP")]))
        s.append(ft)
        s.append(Spacer(1, 1.5))

    s.append(Spacer(1, 3))
    s.append(callout(
        "MATHEMATICAL GUARANTEE: The Groth16 proof system provides computational zero-knowledge. "
        "An adversary cannot extract the biometric secret from the proof, the commitment, or the "
        "blockchain record. Data stored on server: ZERO bytes."))

    s.append(PageBreak())
    return s


# ── PAGE 3: Sections 4 + 5 + Close ──────────────────────────
def page3():
    s = []

    # Section 4
    s.extend(sec("04", "Cost Comparison: Breach Liability vs. ZeroAuth Acquisition"))
    s.append(Paragraph(
        "The economic argument for ZeroAuth is asymmetric: the cost of a single identity breach "
        "routinely exceeds the total cost of deploying ZeroAuth enterprise-wide for a decade.", ST["body"]))

    hdr = [Paragraph("COST CATEGORY", ST["th"]), Paragraph("TRADITIONAL SSO", ST["th"]),
           Paragraph("ZEROAUTH", ST["th"]), Paragraph("DELTA", ST["th"])]
    rows = [hdr]
    for r in [["SSO licensing (10K users)", "$120,000", "$85,000", "-29%"],
              ["Cyber insurance premium", "$250,000", "$95,000", "-62%"],
              ["Biometric storage compliance", "$180,000", "$0", "-100%"],
              ["Breach response (amortized)", "$340,000", "$0", "-100%"],
              ["GDPR/BIPA legal reserve", "$500,000", "$0", "-100%"],
              ["SOC 2 audit (identity scope)", "$75,000", "$35,000", "-53%"]]:
        z = r[2] == "$0"
        rows.append([Paragraph(r[0], ST["tcl"]), Paragraph(r[1], ST["tc"]),
                     Paragraph(r[2], ST["tcg"] if z else ST["tc"]), Paragraph(r[3], ST["tcg"])])
    rows.append([Paragraph("<b>TOTAL ANNUAL</b>", ST["th"]),
                 Paragraph("<b>$1,465,000</b>", ST["tcr"]),
                 Paragraph("<b>$215,000</b>", ST["tcg"]),
                 Paragraph("<b>-85%</b>", ST["tcg"])])
    ct = Table(rows, colWidths=[1.9*inch, 1.2*inch, 1.2*inch, 0.8*inch])
    ct.setStyle(TableStyle(table_style_base() + [
        ("BACKGROUND", (0,-1), (-1,-1), DARK_SURFACE),
        ("LINEABOVE", (0,-1), (-1,-1), 1.2, GREEN_PRIMARY)]))
    s.append(ct)
    s.append(Spacer(1, 3))
    s.append(ph_block([
        "INSERT: Your enterprise's current annual SSO + identity spend",
        "INSERT: Your cyber insurance premium for identity/biometric coverage",
        "INSERT: Projected ZeroAuth deployment cost for your user count"]))

    # Savings stats
    sr = [[stat_cell("$1.25M", "Annual Savings", GREEN_PRIMARY),
           stat_cell("85%", "Cost Reduction", GREEN_PRIMARY),
           stat_cell("0", "Records At Risk", GREEN_PRIMARY)]]
    st2 = Table(sr, colWidths=[1.8*inch]*3)
    st2.setStyle(TableStyle([("ALIGN",(0,0),(-1,-1),"CENTER"), ("VALIGN",(0,0),(-1,-1),"TOP"),
        ("LEFTPADDING",(0,0),(-1,-1),2), ("RIGHTPADDING",(0,0),(-1,-1),2)]))
    s.append(Spacer(1, 2))
    s.append(st2)
    s.append(Spacer(1, 2))
    s.append(hr())

    # Section 5
    s.extend(sec("05", "Technical Validation: Patent No. 202311041001"))
    s.append(Paragraph(
        "ZeroAuth is built on patented technology filed with the Indian Patent Office. "
        "The system directly implements all patent claims:", ST["body"]))

    # Claims table
    ch = [Paragraph("CLAIM", ST["th"]), Paragraph("SPECIFICATION", ST["th"]),
          Paragraph("IMPLEMENTATION", ST["th"])]
    cd = [ch]
    for c in [["1", "Decentralized identity via blockchain-anchored commitments",
               "DIDRegistry.sol on Base L2"],
              ["2", "ZKP verification without biometric disclosure",
               "Groth16/BN128 (486 constraints)"],
              ["3", "SHA-256 biometric hashing, irreversible",
               "identity.ts: SHA-256 + Poseidon"],
              ["4", "Client-side proof, server-side verify",
               "snarkjs WASM / Solidity Verifier"],
              ["5", "On-chain registry with revocation",
               "register + revoke + event audit"]]:
        cd.append([Paragraph(f'<font color="#2ecc71"><b>Claim {c[0]}</b></font>', ST["tc"]),
                   Paragraph(c[1], ST["tcl"]),
                   Paragraph(c[2], ParagraphStyle("cc", fontName="Courier", fontSize=6.5,
                       leading=9, textColor=GREEN_LIGHT, alignment=TA_LEFT))])
    clt = Table(cd, colWidths=[0.7*inch, 2.6*inch, 2.3*inch])
    clt.setStyle(TableStyle(table_style_base()))
    s.append(clt)
    s.append(Spacer(1, 4))

    # Live verification
    s.append(callout(
        "LIVE ON-CHAIN VERIFICATION<br/>"
        '<font size="7" color="#a8f0c8">'
        "DIDRegistry: 0xC68ceB726DDB898E899080021A0B9e7994f63A73  |  "
        "Verifier: 0x58258bf549D8E8694b22B12410F24583D16e1aA4<br/>"
        "Network: Base Sepolia L2 (Chain 84532)  |  Explorer: sepolia.basescan.org"
        "</font>"))
    s.append(Spacer(1, 6))

    # Closing
    s.append(Paragraph(
        '<b><font color="#f0f5f2">The mathematics are non-negotiable.</font></b> '
        "Zero-knowledge proofs provide a cryptographic guarantee -- not a policy, not a promise, "
        "but a mathematical proof -- that biometric data cannot be extracted from ZeroAuth's systems. "
        "The breach surface is not minimized. It is <b>eliminated</b>.", ST["body"]))
    s.append(Spacer(1, 6))

    # CTA
    cta = Table([[Paragraph(
        '<font color="#2ecc71" size="10"><b>Ready to eliminate your identity attack surface?</b></font><br/>'
        '<font color="#8a9b92" size="8">'
        "Contact: hello@zeroauth.io  |  Demo: demo.zeroauth.io  |  GitHub: github.com/zeroauth</font>",
        ST["body"])]], colWidths=[CONTENT_W])
    cta.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1), DARK_SURFACE),
        ("BOX",(0,0),(-1,-1), 1.2, GREEN_PRIMARY),
        ("TOPPADDING",(0,0),(-1,-1), 10), ("BOTTOMPADDING",(0,0),(-1,-1), 10),
        ("LEFTPADDING",(0,0),(-1,-1), 12), ("RIGHTPADDING",(0,0),(-1,-1), 12),
        ("ALIGN",(0,0),(-1,-1),"CENTER")]))
    s.append(cta)
    s.append(Spacer(1, 8))
    s.append(Paragraph(
        "This document contains confidential and proprietary information. "
        "Patent Application No. 202311041001 filed with the Indian Patent Office. All rights reserved.",
        ST["disclaimer"]))

    return s


# ── Build ────────────────────────────────────────────────────
def generate():
    tpl = DarkPageTemplate()
    doc = SimpleDocTemplate(OUTPUT_PATH, pagesize=letter,
        topMargin=40, bottomMargin=46, leftMargin=36, rightMargin=36,
        title="ZeroAuth Technical White Paper", author="ZeroAuth",
        subject="Enterprise SSO Breach Analysis & Zero-Knowledge Proof Architecture",
        creator="ZeroAuth White Paper Generator v2.0")

    story = page1() + page2() + page3()
    doc.build(story, onFirstPage=tpl.on_cover, onLaterPages=tpl.on_page)

    size_kb = os.path.getsize(OUTPUT_PATH) / 1024
    print(f"Generated: {OUTPUT_PATH}")
    print(f"Size: {size_kb:.1f} KB")
    return OUTPUT_PATH

if __name__ == "__main__":
    p = generate()
    print(f'\nDone. Open: open "{p}"')
