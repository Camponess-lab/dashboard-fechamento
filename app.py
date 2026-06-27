import base64
import io
import json
import re
import html
from copy import deepcopy
from datetime import date, datetime

import pandas as pd
import streamlit as st
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

st.set_page_config(
    page_title="Fechamento Gerencial",
    page_icon="🚛",
    layout="wide",
    initial_sidebar_state="expanded",
)

MELI_YELLOW = "#FFE600"
DARK = "#111111"
GREEN = "#00A650"
RED = "#D1242F"
BLUE = "#3483FA"
BG = "#F5F5F5"
CARD = "#FFFFFF"

DEFAULT = {
    "titulo": "FECHAMENTO T1",
    "data": str(date.today()),
    "turno": "T1",
    "meta_dot": 98.0,
    "kpis": {
        "ABS T1": 20.65,
        "DOT T1": 98.03,
        "OOT T1": 98.03,
        "DOT DIA": 97.75,
        "OOT DIA": 97.76,
        "DOT SEMANA": 96.70,
        "V3 T1": 99.27,
        "V4 T1": 94.03,
        "V3 DIA": 99.50,
        "V4 DIA": 93.14,
    },
    "hourly": [
        {"Hora": "08:00", "DOT %": 97.70, "PCTS": 174, "Principais perdas": "55 OR - Missorted / 35 OR - V3 e V4 Misturado / 32 OR - Sem step em Sortation"},
        {"Hora": "09:00", "DOT %": 97.68, "PCTS": 85, "Principais perdas": "67 OR - Missorted"},
        {"Hora": "10:00", "DOT %": 98.08, "PCTS": 951, "Principais perdas": "119 GN - Baixa Volumetria / 118 OR - V3 HU sem físico / 116 ES - Não localizado / 93 VOL / 88 RW"},
        {"Hora": "11:00", "DOT %": 98.13, "PCTS": 197, "Principais perdas": "111 ES - Atraso no processamento / 32 OR - V3 e V4 misto / 20 VOL"},
        {"Hora": "11:30", "DOT %": 97.49, "PCTS": 52, "Principais perdas": "25 ST - Atraso no processamento / 22 EST - Atraso no processamento"},
        {"Hora": "12:00", "DOT %": 97.89, "PCTS": 122, "Principais perdas": "63 EST - Não Localizado / 18 OR - V3 e V4 misto"},
        {"Hora": "13:00", "DOT %": 97.78, "PCTS": 227, "Principais perdas": "89 EST - Pacote não localizado / 27 VOL / 10 ARM - Sem atrelamento / 10 OR - V3 e V4 misto"},
        {"Hora": "14:00", "DOT %": 98.60, "PCTS": 586, "Principais perdas": "191 EST - Não localizado / 80 ARM - Sem atrelamento / 70 VOL não localizado"},
        {"Hora": "15:00", "DOT %": 95.74, "PCTS": 332, "Principais perdas": "200 EST - Não localizado / 50 VOL - Não localizado / 30 OR - HU sem físico"},
    ],
    "retro": [
        {"Data": "W24", "Fechamento %": 96.94, "Atual %": 96.94},
        {"Data": "Dom", "Fechamento %": 96.40, "Atual %": 97.00},
        {"Data": "Seg", "Fechamento %": 97.47, "Atual %": 96.63},
        {"Data": "Ter", "Fechamento %": 97.96, "Atual %": 97.70},
        {"Data": "Qua", "Fechamento %": 97.29, "Atual %": 96.98},
        {"Data": "Qui", "Fechamento %": None, "Atual %": None},
        {"Data": "Sex", "Fechamento %": None, "Atual %": None},
        {"Data": "Sáb", "Fechamento %": None, "Atual %": None},
        {"Data": "W25", "Fechamento %": None, "Atual %": None},
    ],
    "armazenagem": [
        {"Item": "Buffer de cores", "Status": "Controlado"},
        {"Item": "Buffer de V4", "Status": "Saturado"},
        {"Item": "V3 Out branco", "Status": "Controlado"},
        {"Item": "Manga City", "Status": "Controlado"},
        {"Item": "Puxada para T2", "Status": "Finalizado"},
        {"Item": "Estouro", "Status": "Finalizado"},
    ],
    "inbound": {
        "Programado": 100,
        "Antec. T3": 19,
        "Atrasados": 0,
        "Antec. T2": 9,
        "Recebidos": 77,
        "Bolsão": 4,
        "Obs": "",
    },
    "areas": [
        {"Área": "REWORK", "Início": "107", "Final": "100", "Observação": ""},
        {"Área": "ESTEIRA", "Início": "555 - _1 14 mangas, _2 357 mangas", "Final": "32 - _1 zerado, _2 zerado", "Observação": ""},
        {"Área": "SORTER", "Início": "", "Final": "", "Observação": ""},
        {"Área": "VOLUMOSO", "Início": "_1 - 63 + 55 Pallets | Estouro Doca 247", "Final": "_2 - 98 | _3 - 150 + 95", "Observação": ""},
        {"Área": "AÉREO", "Início": "_4: 46 mangas / _5: 2 mangas", "Final": "_4: 48 mangas | 3 paletes | 3 gaylords", "Observação": ""},
    ],
    "perdas_t1": "310 > EST - Atraso no processamento\n272 > EST - Pacote Não Localizado\n183 > OR - V3 e V4 Misturado no pallet\n148 > VOL - Pacote Não Localizado\n125 > OR - Missorted\n119 > GRN - Baixa volumetria",
    "perda_oot": "Sem perdas que diferem do DOT",
    "perdas_area": "609 > Esteira\n526 > Origem\n335 > Armazenagem\n261 > Volumoso\n119 > Granel",
    "acoes": "SPP - 100% do time direcionado à Fênix desde o início do turno.\nVOL - Estouros nas docas _1 e _2, 246 e 247.",
    "dia_anterior": {"Expedidos": 673089, "Perdas": 23992},
    "dia_atual": {"Expedidos": 136534, "Perdas": 2745},
}


def init_state():
    if "dados" not in st.session_state:
        st.session_state["dados"] = deepcopy(DEFAULT)


def num(v, default=0.0):
    try:
        if v is None or v == "":
            return default
        return float(str(v).replace("%", "").replace(".", "").replace(",", ".") if "," in str(v) and "." not in str(v) else v)
    except Exception:
        return default


def int_num(v, default=0):
    try:
        if v is None or v == "":
            return default
        return int(float(str(v).replace(".", "").replace(",", ".")))
    except Exception:
        return default


def pct(v):
    try:
        return f"{float(v):,.2f}%".replace(",", "X").replace(".", ",").replace("X", ".")
    except Exception:
        return "0,00%"


def br_int(v):
    try:
        return f"{int(round(float(v))):,}".replace(",", ".")
    except Exception:
        return "0"


def dot_color(v, meta):
    return GREEN if num(v) >= meta else RED


def calc_dot_from_exp_loss(exp, loss):
    exp = int_num(exp)
    loss = int_num(loss)
    if exp <= 0:
        return 0.0
    return max(0.0, ((exp - loss) / exp) * 100)


def weighted_dot(hourly_df):
    if hourly_df.empty:
        return 0.0
    dots = pd.to_numeric(hourly_df.get("DOT %", pd.Series(dtype=float)), errors="coerce")
    pcts = pd.to_numeric(hourly_df.get("PCTS", pd.Series(dtype=float)), errors="coerce").fillna(0)
    valid = dots.notna()
    if pcts[valid].sum() > 0:
        return float((dots[valid] * pcts[valid]).sum() / pcts[valid].sum())
    if dots[valid].shape[0] > 0:
        return float(dots[valid].mean())
    return 0.0


def sum_losses_from_text(text):
    if not text:
        return 0
    total = 0
    parts = re.split(r"/|\n|;", str(text))
    for p in parts:
        m = re.search(r"(^|\s)(\d{1,6})(?=\s|>|-|$)", p.strip())
        if m:
            total += int(m.group(2))
    return total


def total_hourly_losses(df):
    if df.empty or "Principais perdas" not in df.columns:
        return 0
    return int(sum(sum_losses_from_text(x) for x in df["Principais perdas"].fillna("")))


def build_summary(dados, hourly_df):
    k = dados["kpis"]
    d_ant = dados["dia_anterior"]
    d_at = dados["dia_atual"]
    dot_ant = calc_dot_from_exp_loss(d_ant.get("Expedidos", 0), d_ant.get("Perdas", 0))
    dot_at = calc_dot_from_exp_loss(d_at.get("Expedidos", 0), d_at.get("Perdas", 0))
    total_pcts = pd.to_numeric(hourly_df.get("PCTS", pd.Series(dtype=float)), errors="coerce").fillna(0).sum() if not hourly_df.empty else 0
    total_perdas = total_hourly_losses(hourly_df)
    linhas_hora = []
    for _, r in hourly_df.iterrows():
        if str(r.get("Hora", "")).strip() or pd.notna(r.get("DOT %", None)):
            linhas_hora.append(f"{r.get('Hora','--')} - DOT {pct(num(r.get('DOT %',0)))} | PCTS {br_int(int_num(r.get('PCTS',0)))}")
    return f"""🚛 {dados.get('titulo','FECHAMENTO')} - {dados.get('data','')} 🚛

{dados.get('turno','T1')}:
DOT {dados.get('turno','T1')}: {pct(k.get('DOT T1',0))} | OOT {dados.get('turno','T1')}: {pct(k.get('OOT T1',0))}
V3: {pct(k.get('V3 T1',0))} | V4: {pct(k.get('V4 T1',0))}
ABS: {pct(k.get('ABS T1',0))}

DIA:
DOT DIA: {pct(k.get('DOT DIA',0))} | OOT DIA: {pct(k.get('OOT DIA',0))}
V3: {pct(k.get('V3 DIA',0))} | V4: {pct(k.get('V4 DIA',0))}

DOT SEMANA: {pct(k.get('DOT SEMANA',0))}

📊 HORA A HORA
{chr(10).join(linhas_hora) if linhas_hora else '-'}

Expedidos hora a hora: {br_int(total_pcts)}
Perdas mapeadas: {br_int(total_perdas)}

📍 PRINCIPAIS PERDAS {dados.get('turno','T1')}
{dados.get('perdas_t1','-')}

📍 PERDA OOT {dados.get('turno','T1')}
{dados.get('perda_oot','-')}

📍 PRINCIPAIS PERDAS X ÁREA
{dados.get('perdas_area','-')}

🧭 AÇÕES / OBSERVAÇÕES
{dados.get('acoes','-')}

DIA ANTERIOR: Exp. {br_int(d_ant.get('Expedidos',0))} | Perdas {br_int(d_ant.get('Perdas',0))} | DOT {pct(dot_ant)}
ATUAL: Exp. {br_int(d_at.get('Expedidos',0))} | Perdas {br_int(d_at.get('Perdas',0))} | DOT {pct(dot_at)}"""


def make_pdf(dados, hourly_df):
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=landscape(A4),
        rightMargin=0.7 * cm,
        leftMargin=0.7 * cm,
        topMargin=0.55 * cm,
        bottomMargin=0.55 * cm,
    )
    styles = getSampleStyleSheet()
    title = ParagraphStyle("title", parent=styles["Title"], fontSize=16, leading=18, textColor=colors.HexColor(DARK), alignment=TA_LEFT, spaceAfter=4)
    small = ParagraphStyle("small", parent=styles["Normal"], fontSize=6.7, leading=8, textColor=colors.HexColor(DARK))
    small_center = ParagraphStyle("small_center", parent=small, alignment=TA_CENTER)
    label = ParagraphStyle("label", parent=small, fontSize=7.0, leading=8.2, textColor=colors.HexColor("#555555"), alignment=TA_CENTER)
    value = ParagraphStyle("value", parent=small, fontSize=11, leading=12, textColor=colors.HexColor(DARK), alignment=TA_CENTER)
    h = ParagraphStyle("h", parent=small, fontSize=7.5, leading=8.5, textColor=colors.white, alignment=TA_CENTER)
    story = []
    data_br = ""
    try:
        data_br = datetime.fromisoformat(str(dados.get("data", ""))).strftime("%d/%m/%Y")
    except Exception:
        data_br = str(dados.get("data", ""))
    story.append(Paragraph(f"{dados.get('titulo','FECHAMENTO')} • {data_br}", title))

    meta = num(dados.get("meta_dot", 98))
    avg = weighted_dot(hourly_df)
    total_pcts = pd.to_numeric(hourly_df.get("PCTS", pd.Series(dtype=float)), errors="coerce").fillna(0).sum() if not hourly_df.empty else 0
    total_perdas = total_hourly_losses(hourly_df)
    d_ant = dados["dia_anterior"]
    d_at = dados["dia_atual"]
    dot_at = calc_dot_from_exp_loss(d_at.get("Expedidos", 0), d_at.get("Perdas", 0))

    kpis = dados["kpis"]
    kpi_items = [
        ("DOT T1", pct(kpis.get("DOT T1", 0))), ("OOT T1", pct(kpis.get("OOT T1", 0))), ("DOT DIA", pct(kpis.get("DOT DIA", 0))),
        ("OOT DIA", pct(kpis.get("OOT DIA", 0))), ("DOT SEMANA", pct(kpis.get("DOT SEMANA", 0))), ("ABS", pct(kpis.get("ABS T1", 0))),
        ("DOT H/H", pct(avg)), ("PCTS", br_int(total_pcts)), ("PERDAS", br_int(total_perdas)), ("DOT ATUAL", pct(dot_at)),
    ]
    kpi_table = [[Paragraph(n, label), Paragraph(v, value)] for n, v in kpi_items]
    t = Table([kpi_table[i] + kpi_table[i+1] + kpi_table[i+2] + kpi_table[i+3] + kpi_table[i+4] for i in range(0, len(kpi_table), 5)], colWidths=[1.55*cm, 1.7*cm]*5)
    t.setStyle(TableStyle([
        ("GRID", (0,0), (-1,-1), 0.25, colors.HexColor("#D8D8D8")),
        ("BACKGROUND", (0,0), (-1,-1), colors.white),
        ("VALIGN", (0,0), (-1,-1), "MIDDLE"),
        ("LEFTPADDING", (0,0), (-1,-1), 3),
        ("RIGHTPADDING", (0,0), (-1,-1), 3),
        ("TOPPADDING", (0,0), (-1,-1), 2),
        ("BOTTOMPADDING", (0,0), (-1,-1), 2),
    ]))
    story.append(t)
    story.append(Spacer(1, 0.12 * cm))

    def para(x, limit=130):
        s = str(x or "-").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        return Paragraph(s[:limit] + ("..." if len(s) > limit else ""), small)

    hh = [[Paragraph("Hora", h), Paragraph("DOT", h), Paragraph("PCTS", h), Paragraph("Maiores perdas", h)]]
    for _, r in hourly_df.head(9).iterrows():
        hh.append([Paragraph(str(r.get("Hora", "")), small_center), Paragraph(pct(num(r.get("DOT %", 0))), small_center), Paragraph(br_int(int_num(r.get("PCTS", 0))), small_center), para(r.get("Principais perdas", ""), 150)])
    hh_table = Table(hh, colWidths=[1.4*cm, 1.5*cm, 1.5*cm, 9.0*cm])
    hh_table.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,0), colors.HexColor(DARK)),
        ("GRID", (0,0), (-1,-1), 0.25, colors.HexColor("#CFCFCF")),
        ("VALIGN", (0,0), (-1,-1), "TOP"),
        ("LEFTPADDING", (0,0), (-1,-1), 3),
        ("RIGHTPADDING", (0,0), (-1,-1), 3),
        ("TOPPADDING", (0,0), (-1,-1), 2),
        ("BOTTOMPADDING", (0,0), (-1,-1), 2),
    ]))

    perdas_t1_safe = html.escape(str(dados.get("perdas_t1", "-")))[:700].replace("\n", "<br/>")
    perda_oot_safe = html.escape(str(dados.get("perda_oot", "-")))[:350].replace("\n", "<br/>")
    perdas_area_safe = html.escape(str(dados.get("perdas_area", "-")))[:400].replace("\n", "<br/>")
    acoes_safe = html.escape(str(dados.get("acoes", "-")))[:500].replace("\n", "<br/>")
    perdas = Paragraph(f"<b>Principais perdas {html.escape(str(dados.get('turno','T1')))}</b><br/>{perdas_t1_safe}<br/><br/><b>Perda OOT</b><br/>{perda_oot_safe}", small)
    areas = Paragraph(f"<b>Perdas x área</b><br/>{perdas_area_safe}<br/><br/><b>Ações / observações</b><br/>{acoes_safe}", small)
    side_table = Table([[perdas], [areas]], colWidths=[12.1*cm])
    side_table.setStyle(TableStyle([
        ("GRID", (0,0), (-1,-1), 0.25, colors.HexColor("#CFCFCF")),
        ("BACKGROUND", (0,0), (-1,-1), colors.white),
        ("VALIGN", (0,0), (-1,-1), "TOP"),
        ("LEFTPADDING", (0,0), (-1,-1), 5),
        ("RIGHTPADDING", (0,0), (-1,-1), 5),
        ("TOPPADDING", (0,0), (-1,-1), 4),
        ("BOTTOMPADDING", (0,0), (-1,-1), 4),
    ]))
    main = Table([[hh_table, side_table]], colWidths=[13.4*cm, 12.1*cm])
    story.append(main)
    story.append(Spacer(1, 0.12 * cm))

    arm_df = pd.DataFrame(dados.get("armazenagem", []))
    inb = dados.get("inbound", {})
    arm_text = " | ".join([f"{r.get('Item','')}: {r.get('Status','')}" for _, r in arm_df.iterrows()]) if not arm_df.empty else "-"
    inb_text = " | ".join([f"{k}: {v}" for k, v in inb.items() if k != "Obs"]) + (f" | Obs: {inb.get('Obs','')}" if inb.get("Obs") else "")
    bottom = Table([
        [Paragraph("Armazenagem", h), Paragraph("Inbound", h), Paragraph("Dia anterior x atual", h)],
        [para(arm_text, 270), para(inb_text, 270), para(f"Anterior: Exp. {br_int(d_ant.get('Expedidos',0))} / Perdas {br_int(d_ant.get('Perdas',0))} | Atual: Exp. {br_int(d_at.get('Expedidos',0))} / Perdas {br_int(d_at.get('Perdas',0))}", 270)],
    ], colWidths=[8.5*cm, 8.5*cm, 8.5*cm])
    bottom.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,0), colors.HexColor(DARK)),
        ("GRID", (0,0), (-1,-1), 0.25, colors.HexColor("#CFCFCF")),
        ("VALIGN", (0,0), (-1,-1), "TOP"),
        ("LEFTPADDING", (0,0), (-1,-1), 4),
        ("RIGHTPADDING", (0,0), (-1,-1), 4),
        ("TOPPADDING", (0,0), (-1,-1), 3),
        ("BOTTOMPADDING", (0,0), (-1,-1), 3),
    ]))
    story.append(bottom)
    story.append(Spacer(1, 0.08 * cm))
    story.append(Paragraph(f"Regra visual: DOT/OOT em verde somente a partir de {pct(meta)} • gerado em {datetime.now().strftime('%d/%m/%Y %H:%M')}", small))
    doc.build(story)
    buffer.seek(0)
    return buffer.getvalue()


def make_html_report(dados, hourly_df):
    meta = num(dados.get("meta_dot", 98))
    avg = weighted_dot(hourly_df)
    total_pcts = pd.to_numeric(hourly_df.get("PCTS", pd.Series(dtype=float)), errors="coerce").fillna(0).sum() if not hourly_df.empty else 0
    total_perdas = total_hourly_losses(hourly_df)
    rows = "".join(
        f"<tr><td>{r.get('Hora','')}</td><td class='{ 'ok' if num(r.get('DOT %',0)) >= meta else 'bad'}'>{pct(num(r.get('DOT %',0)))}</td><td>{br_int(int_num(r.get('PCTS',0)))}</td><td>{str(r.get('Principais perdas',''))}</td></tr>"
        for _, r in hourly_df.iterrows()
    )
    k = dados["kpis"]
    cards = "".join(
        f"<div class='kpi'><span>{name}</span><b class='{ 'ok' if num(val) >= meta and 'ABS' not in name else 'bad' if ('DOT' in name or 'OOT' in name) and num(val) < meta else ''}'>{pct(num(val))}</b></div>"
        for name, val in k.items()
    )
    return f"""<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>{dados.get('titulo','Fechamento')}</title>
<style>
@page {{ size: A4 landscape; margin: 8mm; }}
body {{ font-family: Arial, sans-serif; background:#f4f4f4; color:#111; margin:0; }}
.sheet {{ padding:10px; }}
.header {{ display:flex; justify-content:space-between; align-items:center; border-left:10px solid #ffe600; background:white; padding:10px; border-radius:12px; }}
h1 {{ margin:0; font-size:22px; }}
.kpis {{ display:grid; grid-template-columns: repeat(10, 1fr); gap:6px; margin:8px 0; }}
.kpi {{ background:white; border-radius:10px; padding:8px 6px; text-align:center; border:1px solid #ddd; }}
.kpi span {{ display:block; font-size:10px; color:#555; font-weight:700; }}
.kpi b {{ display:block; font-size:15px; margin-top:3px; }}
.grid {{ display:grid; grid-template-columns: 1.08fr .92fr; gap:8px; }}
.card {{ background:white; border:1px solid #ddd; border-radius:12px; padding:8px; }}
h2 {{ font-size:13px; margin:0 0 6px; background:#111; color:white; padding:6px; border-radius:8px; }}
table {{ width:100%; border-collapse:collapse; font-size:10px; }}
th {{ background:#111; color:white; padding:5px; }}
td {{ border:1px solid #ddd; padding:4px; vertical-align:top; }}
.ok {{ color:#00a650; }} .bad {{ color:#d1242f; }}
.text {{ white-space:pre-wrap; font-size:10.5px; line-height:1.25; }}
.footer {{ margin-top:6px; font-size:9px; color:#555; display:flex; justify-content:space-between; }}
@media print {{ body {{ background:white; }} .sheet {{ padding:0; }} }}
</style></head><body><div class="sheet">
<div class="header"><div><h1>{dados.get('titulo','FECHAMENTO')}</h1><b>{dados.get('data','')} • Visão gerencial</b></div><div><b>DOT H/H: {pct(avg)}</b><br>PCTS {br_int(total_pcts)} • Perdas {br_int(total_perdas)}</div></div>
<div class="kpis">{cards}</div>
<div class="grid"><div class="card"><h2>DOT hora a hora</h2><table><thead><tr><th>Hora</th><th>DOT</th><th>PCTS</th><th>Maiores perdas</th></tr></thead><tbody>{rows}</tbody></table></div>
<div>
<div class="card"><h2>Principais perdas {dados.get('turno','T1')}</h2><div class="text">{dados.get('perdas_t1','-')}</div></div>
<div class="card" style="margin-top:8px"><h2>Perda OOT</h2><div class="text">{dados.get('perda_oot','-')}</div></div>
<div class="card" style="margin-top:8px"><h2>Perdas x área</h2><div class="text">{dados.get('perdas_area','-')}</div></div>
<div class="card" style="margin-top:8px"><h2>Ações e observações</h2><div class="text">{dados.get('acoes','-')}</div></div>
</div></div>
<div class="footer"><span>DOT/OOT verde somente acima da meta de {pct(meta)}</span><span>Gerado em {datetime.now().strftime('%d/%m/%Y %H:%M')}</span></div>
</div></body></html>"""


def style_page():
    # CSS com contraste fixo + visual gerencial mais moderno.
    # A ideia é manter o dashboard bonito e legível mesmo quando o usuário troca Dark/Light.
    st.markdown(
        f"""
        <style>
        :root {{
            --ml-yellow: #FFE600;
            --ml-yellow-soft: #FFF7B8;
            --ml-blue: #3483FA;
            --ink: #101114;
            --muted: #667085;
            --line: #E7E7EA;
            --surface: #FFFFFF;
            --surface-2: #F7F8FA;
            --green: {GREEN};
            --red: {RED};
            --amber: #F59E0B;
            --shadow: 0 14px 38px rgba(16, 17, 20, .08);
            --radius: 22px;
        }}

        .stApp {{
            background:
                radial-gradient(circle at top left, rgba(255,230,0,.26), transparent 28rem),
                linear-gradient(135deg, #FAFAFA 0%, #F2F4F7 100%) !important;
            color: var(--ink) !important;
        }}
        .main .block-container {{
            padding-top: 1.1rem;
            padding-bottom: 2.2rem;
            max-width: 1500px;
        }}

        .stApp h1, .stApp h2, .stApp h3, .stApp h4, .stApp h5, .stApp h6,
        .stApp p, .stApp label, .stApp span, .stApp small,
        .stApp div[data-testid="stMarkdownContainer"] {{
            color: var(--ink) !important;
        }}

        [data-testid="stSidebar"] {{
            background: linear-gradient(180deg, #111111 0%, #202124 100%) !important;
            border-right: 1px solid rgba(255,255,255,.12);
        }}
        [data-testid="stSidebar"] *,
        [data-testid="stSidebar"] div[data-testid="stMarkdownContainer"],
        [data-testid="stSidebar"] label,
        [data-testid="stSidebar"] p,
        [data-testid="stSidebar"] span {{
            color: #FFFFFF !important;
        }}
        [data-testid="stSidebar"] .stTextInput input,
        [data-testid="stSidebar"] .stNumberInput input,
        [data-testid="stSidebar"] .stDateInput input,
        [data-testid="stSidebar"] .stSelectbox div[data-baseweb="select"] > div {{
            background: #FFFFFF !important;
            color: #111111 !important;
        }}

        .stTextInput input, .stNumberInput input, .stTextArea textarea,
        .stDateInput input, .stSelectbox div[data-baseweb="select"] > div,
        [data-testid="stFileUploader"] section {{
            background: #FFFFFF !important;
            color: #111111 !important;
            border: 1px solid #D9DDE3 !important;
            border-radius: 12px !important;
        }}
        .stTextInput input::placeholder, .stTextArea textarea::placeholder {{ color: #777 !important; }}
        .stSelectbox div[data-baseweb="select"] span,
        .stSelectbox div[data-baseweb="select"] svg {{ color: #111 !important; fill: #111 !important; }}

        .stButton button, .stDownloadButton button {{
            background: linear-gradient(180deg, #FFE600, #F4D900) !important;
            color: #111111 !important;
            border: 1px solid #D6C400 !important;
            font-weight: 900 !important;
            border-radius: 14px !important;
            box-shadow: 0 8px 20px rgba(0,0,0,.08) !important;
            min-height: 44px;
        }}
        .stButton button:hover, .stDownloadButton button:hover {{
            filter: brightness(.98);
            transform: translateY(-1px);
        }}
        .stButton button *, .stDownloadButton button * {{ color: #111 !important; }}

        button[data-baseweb="tab"] {{
            background: rgba(255,255,255,.65) !important;
            border-radius: 999px !important;
            margin-right: 6px !important;
            border: 1px solid rgba(16,17,20,.06) !important;
        }}
        button[data-baseweb="tab"] p {{ color: #111 !important; font-weight: 900 !important; }}

        div[data-testid="stMetric"] {{
            background: #FFFFFF !important;
            border: 1px solid #E6E8ED !important;
            padding: 14px !important;
            border-radius: 18px !important;
            box-shadow: var(--shadow) !important;
        }}
        div[data-testid="stMetric"] *, div[data-testid="stMetricLabel"], div[data-testid="stMetricValue"] {{ color: #111 !important; }}

        div[data-testid="stDataFrame"], div[data-testid="stDataEditor"] {{
            background: #FFFFFF !important;
            color: #111111 !important;
            border-radius: 18px !important;
            border: 1px solid #E6E8ED !important;
            overflow: hidden;
            box-shadow: 0 10px 28px rgba(16,17,20,.04) !important;
        }}
        div[data-testid="stCodeBlock"], div[data-testid="stCodeBlock"] pre, div[data-testid="stCodeBlock"] code {{
            background: #FFFFFF !important;
            color: #111111 !important;
            border: 1px solid #E6E8ED !important;
            border-radius: 16px !important;
        }}
        .stAlert, .stAlert * {{ color: #111111 !important; }}

        .hero {{
            position: relative;
            overflow: hidden;
            background: linear-gradient(135deg, #111111 0%, #232323 46%, #3A3420 100%) !important;
            border: 1px solid rgba(255,255,255,.10);
            border-radius: 28px;
            padding: 24px 26px;
            margin-bottom: 18px;
            box-shadow: 0 22px 55px rgba(16,17,20,.16);
        }}
        .hero:after {{
            content: "";
            position: absolute;
            width: 320px;
            height: 320px;
            border-radius: 50%;
            right: -80px;
            top: -120px;
            background: rgba(255,230,0,.35);
            filter: blur(2px);
        }}
        .hero .eyebrow {{
            display: inline-flex;
            align-items: center;
            gap: 8px;
            background: rgba(255,230,0,.16);
            color: #FFE600 !important;
            border: 1px solid rgba(255,230,0,.32);
            border-radius: 999px;
            padding: 7px 12px;
            font-size: 12px;
            font-weight: 900;
            letter-spacing: .3px;
            text-transform: uppercase;
        }}
        .hero h1 {{
            margin: 13px 0 6px;
            color: #FFFFFF !important;
            font-size: 34px;
            line-height: 1.06;
            letter-spacing: -0.8px;
        }}
        .hero p {{ color: #E9EDF3 !important; margin: 0; font-weight: 700; }}
        .hero .hero-grid {{
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 10px;
            margin-top: 18px;
            max-width: 760px;
        }}
        .hero-stat {{
            background: rgba(255,255,255,.08);
            border: 1px solid rgba(255,255,255,.14);
            border-radius: 16px;
            padding: 11px 13px;
            backdrop-filter: blur(8px);
        }}
        .hero-stat span {{ color: #C9CED7 !important; font-size: 11px; font-weight: 800; text-transform: uppercase; }}
        .hero-stat b {{ color: #FFFFFF !important; display:block; font-size: 17px; margin-top: 2px; }}

        .kpi-grid-modern {{
            display:grid;
            grid-template-columns: repeat(5, minmax(0, 1fr));
            gap: 12px;
            margin: 12px 0 18px;
        }}
        .metric-card {{
            background: var(--surface) !important;
            color: var(--ink) !important;
            border: 1px solid #E6E8ED;
            border-radius: 22px;
            padding: 16px;
            box-shadow: var(--shadow);
            min-height: 118px;
            position: relative;
            overflow: hidden;
        }}
        .metric-card:before {{
            content:"";
            position:absolute;
            left:0;
            top:0;
            bottom:0;
            width: 6px;
            background: var(--ml-blue);
        }}
        .metric-card.ok:before {{ background: var(--green); }}
        .metric-card.bad:before {{ background: var(--red); }}
        .metric-card.warn:before {{ background: var(--amber); }}
        .metric-card.neutral:before {{ background: var(--ml-blue); }}
        .metric-card .label {{ color: #667085 !important; font-size: 12px; font-weight: 900; text-transform: uppercase; letter-spacing: .25px; }}
        .metric-card .value {{ color: #101114 !important; font-size: 30px; font-weight: 1000; line-height: 1; margin-top: 10px; letter-spacing: -1px; }}
        .metric-card .caption {{ color: #667085 !important; font-size: 12px; font-weight: 800; margin-top: 8px; }}
        .metric-card .pill {{
            position:absolute;
            top: 13px;
            right: 13px;
            border-radius: 999px;
            padding: 5px 9px;
            font-size: 11px;
            font-weight: 1000;
        }}
        .metric-card.ok .pill {{ background: rgba(0,166,80,.10); color: var(--green) !important; }}
        .metric-card.bad .pill {{ background: rgba(209,36,47,.10); color: var(--red) !important; }}
        .metric-card.warn .pill {{ background: rgba(245,158,11,.13); color: var(--amber) !important; }}
        .metric-card.neutral .pill {{ background: rgba(52,131,250,.10); color: var(--ml-blue) !important; }}

        .section-card {{
            background: rgba(255,255,255,.92) !important;
            border: 1px solid #E6E8ED;
            border-radius: 24px;
            padding: 18px;
            margin-bottom: 14px;
            box-shadow: var(--shadow);
        }}
        .section-card h3 {{
            margin: 0 0 12px !important;
            font-size: 18px !important;
            letter-spacing: -.2px;
        }}
        .section-card .subtle {{ color: #667085 !important; font-size: 12px; font-weight: 800; }}
        .insight-list {{ display: flex; flex-direction: column; gap: 9px; }}
        .insight {{
            display:flex;
            justify-content:space-between;
            gap: 10px;
            background: #F8FAFC;
            border: 1px solid #EAECF0;
            border-radius: 16px;
            padding: 11px 12px;
            font-weight: 800;
        }}
        .insight span {{ color:#667085 !important; font-size: 12px; }}
        .insight b {{ color:#101114 !important; }}
        .text-box {{
            background: #F8FAFC;
            border: 1px solid #EAECF0;
            border-radius: 16px;
            padding: 12px;
            white-space: pre-wrap;
            font-size: 13px;
            line-height: 1.36;
            color:#101114 !important;
            max-height: 330px;
            overflow: auto;
        }}
        .status-ok {{ color: var(--green) !important; font-weight: 1000 !important; }}
        .status-bad {{ color: var(--red) !important; font-weight: 1000 !important; }}
        .status-warn {{ color: var(--amber) !important; font-weight: 1000 !important; }}
        .divider-soft {{ height:1px; background:#E6E8ED; margin: 14px 0; }}

        @media (max-width: 1100px) {{
            .kpi-grid-modern {{ grid-template-columns: repeat(2, minmax(0, 1fr)); }}
            .hero .hero-grid {{ grid-template-columns: 1fr; }}
        }}
        </style>
        """,
        unsafe_allow_html=True,
    )

def sidebar(dados):
    st.sidebar.title("🚛 Fechamento")
    dados["titulo"] = st.sidebar.text_input("Título", dados.get("titulo", "FECHAMENTO T1"))
    dados["turno"] = st.sidebar.selectbox("Turno", ["T1", "T2", "T3", "DIA"], index=["T1", "T2", "T3", "DIA"].index(dados.get("turno", "T1")) if dados.get("turno") in ["T1", "T2", "T3", "DIA"] else 0)
    try:
        current_date = datetime.fromisoformat(str(dados.get("data", date.today()))).date()
    except Exception:
        current_date = date.today()
    dados["data"] = str(st.sidebar.date_input("Data", current_date, format="DD/MM/YYYY"))
    dados["meta_dot"] = st.sidebar.number_input("Meta DOT/OOT", min_value=0.0, max_value=100.0, value=float(dados.get("meta_dot", 98.0)), step=0.1, format="%.2f")
    st.sidebar.divider()
    uploaded = st.sidebar.file_uploader("Importar JSON salvo", type=["json"])
    if uploaded is not None:
        try:
            st.session_state["dados"] = json.loads(uploaded.getvalue().decode("utf-8"))
            st.sidebar.success("Dados importados com sucesso.")
            st.rerun()
        except Exception as e:
            st.sidebar.error(f"Não consegui importar: {e}")
    if st.sidebar.button("Restaurar exemplo inicial"):
        st.session_state["dados"] = deepcopy(DEFAULT)
        st.rerun()


def kpi_editor(dados):
    st.subheader("KPIs principais")
    c1, c2, c3, c4, c5 = st.columns(5)
    keys = list(dados["kpis"].keys())
    cols = [c1, c2, c3, c4, c5]
    for i, key in enumerate(keys):
        with cols[i % 5]:
            dados["kpis"][key] = st.number_input(key, value=float(num(dados["kpis"].get(key, 0))), step=0.01, format="%.2f", key=f"kpi_{key}")



def safe(v):
    return html.escape(str(v if v is not None else ""))


def metric_status(name, value, meta):
    name_u = str(name).upper()
    v = num(value)
    if "ABS" in name_u:
        if v <= 4:
            return "ok", "OK"
        if v <= 13:
            return "warn", "ATENÇÃO"
        return "bad", "CRÍTICO"
    if "DOT" in name_u or "OOT" in name_u or "V3" in name_u or "V4" in name_u:
        return ("ok", "META") if v >= meta else ("bad", "ABAIXO")
    return "neutral", "INFO"


def render_metric_card(label, value, status="neutral", pill="INFO", caption=""):
    return f"""
    <div class="metric-card {status}">
      <div class="pill">{safe(pill)}</div>
      <div class="label">{safe(label)}</div>
      <div class="value">{safe(value)}</div>
      <div class="caption">{safe(caption)}</div>
    </div>
    """


def render_hero(dados, avg, total_pcts, total_perdas):
    try:
        data_br = datetime.fromisoformat(str(dados.get("data", ""))).strftime("%d/%m/%Y")
    except Exception:
        data_br = str(dados.get("data", ""))
    meta = num(dados.get("meta_dot", 98))
    return f"""
    <div class="hero">
      <div class="eyebrow">🚛 Fechamento gerencial</div>
      <h1>{safe(dados.get('titulo','FECHAMENTO'))}</h1>
      <p>Visão clean para liderança • preenchimento operacional • PDF em 1 página</p>
      <div class="hero-grid">
        <div class="hero-stat"><span>Data / Turno</span><b>{safe(data_br)} • {safe(dados.get('turno','T1'))}</b></div>
        <div class="hero-stat"><span>DOT hora a hora</span><b>{safe(pct(avg))}</b></div>
        <div class="hero-stat"><span>Volume monitorado</span><b>{safe(br_int(total_pcts))} pcts • {safe(br_int(total_perdas))} perdas</b></div>
      </div>
    </div>
    """


def render_insight_row(label, value, extra=""):
    return f"""<div class="insight"><div><span>{safe(label)}</span><br><b>{safe(value)}</b></div><div>{extra}</div></div>"""


def build_metric_grid(dados, hourly_df):
    meta = num(dados.get("meta_dot", 98))
    k = dados.get("kpis", {})
    avg = weighted_dot(hourly_df)
    total_pcts = pd.to_numeric(hourly_df.get("PCTS", pd.Series(dtype=float)), errors="coerce").fillna(0).sum() if not hourly_df.empty else 0
    total_perdas = total_hourly_losses(hourly_df)
    dot_at = calc_dot_from_exp_loss(dados["dia_atual"].get("Expedidos", 0), dados["dia_atual"].get("Perdas", 0))
    items = [
        ("DOT T1", pct(k.get("DOT T1", 0)), *metric_status("DOT T1", k.get("DOT T1", 0), meta), f"Meta {pct(meta)}"),
        ("OOT T1", pct(k.get("OOT T1", 0)), *metric_status("OOT T1", k.get("OOT T1", 0), meta), f"Meta {pct(meta)}"),
        ("DOT DIA", pct(k.get("DOT DIA", 0)), *metric_status("DOT DIA", k.get("DOT DIA", 0), meta), "Acumulado do dia"),
        ("DOT H/H", pct(avg), *metric_status("DOT H/H", avg, meta), "Média ponderada pelos PCTS"),
        ("ABS", pct(k.get("ABS T1", 0)), *metric_status("ABS", k.get("ABS T1", 0), meta), "Atenção operacional"),
        ("OOT DIA", pct(k.get("OOT DIA", 0)), *metric_status("OOT DIA", k.get("OOT DIA", 0), meta), "Acumulado do dia"),
        ("V3 T1", pct(k.get("V3 T1", 0)), *metric_status("V3 T1", k.get("V3 T1", 0), meta), "Performance V3"),
        ("V4 T1", pct(k.get("V4 T1", 0)), *metric_status("V4 T1", k.get("V4 T1", 0), meta), "Performance V4"),
        ("PCTS", br_int(total_pcts), "neutral", "VOLUME", "Total hora a hora"),
        ("PERDAS", br_int(total_perdas), "bad" if total_perdas > 0 else "ok", "MAPEADO", "Perdas extraídas dos textos"),
    ]
    return '<div class="kpi-grid-modern">' + ''.join(render_metric_card(a,b,c,d,e) for a,b,c,d,e in items) + '</div>'


def build_critical_hours(hourly_df, meta):
    if hourly_df.empty:
        return "<div class='text-box'>Sem dados preenchidos.</div>"
    rows = []
    work = hourly_df.copy()
    work["DOT %"] = pd.to_numeric(work.get("DOT %", pd.Series(dtype=float)), errors="coerce")
    work["PCTS"] = pd.to_numeric(work.get("PCTS", pd.Series(dtype=float)), errors="coerce").fillna(0)
    critical = work[(work["DOT %"].notna()) & (work["DOT %"] < meta)].sort_values("DOT %").head(5)
    if critical.empty:
        return "<div class='text-box'><span class='status-ok'>Nenhuma hora abaixo da meta preenchida.</span></div>"
    for _, r in critical.iterrows():
        perdas = safe(str(r.get("Principais perdas", "-"))[:95])
        rows.append(
            f"<div class='insight'><div><span>{safe(r.get('Hora','--'))}</span><br><b class='status-bad'>DOT {pct(num(r.get('DOT %',0)))}</b></div><div style='text-align:right'><span>PCTS</span><br><b>{br_int(int_num(r.get('PCTS',0)))}</b></div></div><div class='text-box' style='margin:-5px 0 8px'>{perdas}</div>"
        )
    return ''.join(rows)


def build_area_status_html(dados):
    arm_df = pd.DataFrame(dados.get("armazenagem", []))
    if arm_df.empty:
        return "<div class='text-box'>Sem status preenchido.</div>"
    rows = []
    for _, r in arm_df.iterrows():
        status = str(r.get("Status", ""))
        cls = "status-ok" if any(x in status.lower() for x in ["control", "final", "ok", "normal"]) else "status-bad" if any(x in status.lower() for x in ["satur", "crít", "crit", "atras", "risco"]) else "status-warn"
        rows.append(f"<div class='insight'><div><span>Item</span><br><b>{safe(r.get('Item',''))}</b></div><div><span>Status</span><br><b class='{cls}'>{safe(status)}</b></div></div>")
    return ''.join(rows)

def main():
    init_state()
    dados = st.session_state["dados"]
    style_page()
    sidebar(dados)

    header_df = pd.DataFrame(dados.get("hourly", []))
    header_avg = weighted_dot(header_df)
    header_pcts = pd.to_numeric(header_df.get("PCTS", pd.Series(dtype=float)), errors="coerce").fillna(0).sum() if not header_df.empty else 0
    header_losses = total_hourly_losses(header_df)
    st.markdown(render_hero(dados, header_avg, header_pcts, header_losses), unsafe_allow_html=True)

    tab1, tab2, tab3, tab4 = st.tabs(["📝 Preenchimento", "📊 Visão gerencial", "📤 Exportar", "🌐 Subir online"])

    with tab1:
        kpi_editor(dados)
        st.divider()
        st.subheader("DOT hora a hora")
        hourly_df = pd.DataFrame(dados.get("hourly", []))
        hourly_df = st.data_editor(
            hourly_df,
            num_rows="dynamic",
            use_container_width=True,
            column_config={
                "Hora": st.column_config.TextColumn("Hora", help="Ex.: 08:00"),
                "DOT %": st.column_config.NumberColumn("DOT %", min_value=0, max_value=100, step=0.01, format="%.2f"),
                "PCTS": st.column_config.NumberColumn("PCTS", min_value=0, step=1),
                "Principais perdas": st.column_config.TextColumn("Principais perdas", width="large"),
            },
            key="hourly_editor",
        )
        dados["hourly"] = hourly_df.fillna("").to_dict("records")

        col_a, col_b = st.columns(2)
        with col_a:
            st.subheader("Status armazenagem")
            arm_df = pd.DataFrame(dados.get("armazenagem", []))
            arm_df = st.data_editor(arm_df, num_rows="dynamic", use_container_width=True, key="arm_editor")
            dados["armazenagem"] = arm_df.fillna("").to_dict("records")
        with col_b:
            st.subheader("Inbound")
            inb = dados.get("inbound", {})
            grid = st.columns(3)
            for i, key in enumerate(["Programado", "Antec. T3", "Atrasados", "Antec. T2", "Recebidos", "Bolsão"]):
                with grid[i % 3]:
                    inb[key] = st.number_input(key, value=int_num(inb.get(key, 0)), step=1, key=f"inb_{key}")
            inb["Obs"] = st.text_area("Obs. Inbound", inb.get("Obs", ""), height=70)
            dados["inbound"] = inb

        st.subheader("Status processamento por área")
        areas_df = pd.DataFrame(dados.get("areas", []))
        areas_df = st.data_editor(areas_df, num_rows="dynamic", use_container_width=True, key="areas_editor")
        dados["areas"] = areas_df.fillna("").to_dict("records")

        st.subheader("Perdas, OOT e ações")
        p1, p2, p3 = st.columns(3)
        with p1:
            dados["perdas_t1"] = st.text_area("Principais perdas", dados.get("perdas_t1", ""), height=190)
        with p2:
            dados["perda_oot"] = st.text_area("Perda OOT", dados.get("perda_oot", ""), height=190)
        with p3:
            dados["perdas_area"] = st.text_area("Principais perdas x área", dados.get("perdas_area", ""), height=190)
        dados["acoes"] = st.text_area("Ações e observações", dados.get("acoes", ""), height=120)

        st.subheader("Dia anterior x atual")
        d1, d2 = st.columns(2)
        with d1:
            st.markdown("**Dia anterior**")
            dados["dia_anterior"]["Expedidos"] = st.number_input("Expedidos anterior", value=int_num(dados["dia_anterior"].get("Expedidos", 0)), step=1)
            dados["dia_anterior"]["Perdas"] = st.number_input("Perdas anterior", value=int_num(dados["dia_anterior"].get("Perdas", 0)), step=1)
        with d2:
            st.markdown("**Atual**")
            dados["dia_atual"]["Expedidos"] = st.number_input("Expedidos atual", value=int_num(dados["dia_atual"].get("Expedidos", 0)), step=1)
            dados["dia_atual"]["Perdas"] = st.number_input("Perdas atual", value=int_num(dados["dia_atual"].get("Perdas", 0)), step=1)

    with tab2:
        hourly_df = pd.DataFrame(dados.get("hourly", []))
        meta = num(dados.get("meta_dot", 98))
        avg = weighted_dot(hourly_df)
        total_pcts = pd.to_numeric(hourly_df.get("PCTS", pd.Series(dtype=float)), errors="coerce").fillna(0).sum() if not hourly_df.empty else 0
        total_perdas = total_hourly_losses(hourly_df)
        dot_at = calc_dot_from_exp_loss(dados["dia_atual"].get("Expedidos", 0), dados["dia_atual"].get("Perdas", 0))
        dot_ant = calc_dot_from_exp_loss(dados["dia_anterior"].get("Expedidos", 0), dados["dia_anterior"].get("Perdas", 0))

        st.markdown(build_metric_grid(dados, hourly_df), unsafe_allow_html=True)

        top_left, top_right = st.columns([1.45, .9])
        with top_left:
            st.markdown("""
            <div class="section-card">
              <h3>📈 Evolução DOT hora a hora</h3>
              <div class="subtle">Linha de tendência operacional para identificar horários críticos rapidamente.</div>
            </div>
            """, unsafe_allow_html=True)
            chart_df = hourly_df.copy()
            if not chart_df.empty:
                chart_df["DOT %"] = pd.to_numeric(chart_df.get("DOT %", pd.Series(dtype=float)), errors="coerce")
                chart_df = chart_df.dropna(subset=["DOT %"])
                if not chart_df.empty:
                    st.line_chart(chart_df.set_index("Hora")[["DOT %"]], use_container_width=True, height=330)
                else:
                    st.info("Preencha o DOT hora a hora para exibir o gráfico.")
            else:
                st.info("Preencha o DOT hora a hora para exibir o gráfico.")

        with top_right:
            status_class = "status-ok" if dot_at >= meta else "status-bad"
            status_text = "dentro da meta" if dot_at >= meta else "abaixo da meta"
            delta = dot_at - dot_ant
            delta_class = "status-ok" if delta >= 0 else "status-bad"
            st.markdown(f"""
            <div class="section-card">
              <h3>🧭 Radar do turno</h3>
              <div class="insight-list">
                {render_insight_row('DOT atual', pct(dot_at), f"<b class='{status_class}'>{status_text}</b>")}
                {render_insight_row('Variação vs. anterior', pct(delta), f"<b class='{delta_class}'>{'+' if delta >= 0 else ''}{pct(delta)}</b>")}
                {render_insight_row('Expedidos atual', br_int(dados['dia_atual'].get('Expedidos', 0)), '')}
                {render_insight_row('Perdas atual', br_int(dados['dia_atual'].get('Perdas', 0)), '')}
              </div>
              <div class="divider-soft"></div>
              <div class="subtle">Regra visual: DOT/OOT em verde somente a partir de {pct(meta)}.</div>
            </div>
            """, unsafe_allow_html=True)

        mid_left, mid_right = st.columns([1.05, .95])
        with mid_left:
            st.markdown("""
            <div class="section-card">
              <h3>⏱️ Horários abaixo da meta</h3>
            """, unsafe_allow_html=True)
            st.markdown(build_critical_hours(hourly_df, meta), unsafe_allow_html=True)
            st.markdown("</div>", unsafe_allow_html=True)

            st.markdown("""
            <div class="section-card">
              <h3>📦 Hora a hora detalhado</h3>
            </div>
            """, unsafe_allow_html=True)
            st.dataframe(hourly_df, use_container_width=True, hide_index=True, height=330)

        with mid_right:
            st.markdown(f"""
            <div class="section-card">
              <h3>📍 Principais perdas</h3>
              <div class="text-box">{safe(dados.get('perdas_t1','-'))}</div>
            </div>
            <div class="section-card">
              <h3>🏭 Perdas por área</h3>
              <div class="text-box">{safe(dados.get('perdas_area','-'))}</div>
            </div>
            <div class="section-card">
              <h3>✅ Ações / observações</h3>
              <div class="text-box">{safe(dados.get('acoes','-'))}</div>
            </div>
            """, unsafe_allow_html=True)

        low_left, low_right = st.columns([.95, 1.05])
        with low_left:
            st.markdown("""
            <div class="section-card">
              <h3>🧱 Status armazenagem</h3>
            """, unsafe_allow_html=True)
            st.markdown(build_area_status_html(dados), unsafe_allow_html=True)
            st.markdown("</div>", unsafe_allow_html=True)
        with low_right:
            inb = dados.get("inbound", {})
            inbound_html = ''.join(render_insight_row(k, br_int(v) if isinstance(v, (int, float)) or str(v).isdigit() else v) for k, v in inb.items() if k != "Obs")
            obs = safe(inb.get("Obs", "")) if inb.get("Obs") else "Sem observação."
            st.markdown(f"""
            <div class="section-card">
              <h3>📥 Inbound</h3>
              <div class="insight-list">{inbound_html}</div>
              <div class="divider-soft"></div>
              <div class="text-box">{obs}</div>
            </div>
            """, unsafe_allow_html=True)

        st.markdown("### 💬 Resumo para WhatsApp")
        st.code(build_summary(dados, hourly_df), language="text")

    with tab3:
        hourly_df = pd.DataFrame(dados.get("hourly", []))
        summary = build_summary(dados, hourly_df)
        pdf_bytes = make_pdf(dados, hourly_df)
        html_report = make_html_report(dados, hourly_df)
        json_bytes = json.dumps(dados, ensure_ascii=False, indent=2).encode("utf-8")

        c1, c2, c3, c4 = st.columns(4)
        with c1:
            st.download_button("📄 Baixar PDF 1 página", data=pdf_bytes, file_name="fechamento_gerencial.pdf", mime="application/pdf", use_container_width=True)
        with c2:
            st.download_button("🌐 Baixar HTML gerencial", data=html_report.encode("utf-8"), file_name="fechamento_gerencial.html", mime="text/html", use_container_width=True)
        with c3:
            st.download_button("💬 Baixar resumo TXT", data=summary.encode("utf-8"), file_name="resumo_whatsapp.txt", mime="text/plain", use_container_width=True)
        with c4:
            st.download_button("💾 Salvar dados JSON", data=json_bytes, file_name="dados_fechamento.json", mime="application/json", use_container_width=True)
        st.info("Para continuar depois, baixe o JSON e importe pelo menu lateral quando abrir novamente o app.")

    with tab4:
        st.markdown("""
        ### Como subir online

        **Modelo recomendado:** Streamlit Community Cloud + GitHub.

        1. Crie uma conta no GitHub.
        2. Crie um repositório novo chamado `dashboard-fechamento`.
        3. Envie os arquivos `app.py`, `requirements.txt` e a pasta `.streamlit`.
        4. Entre no Streamlit Community Cloud.
        5. Clique em **Create app**.
        6. Selecione o repositório, branch `main` e arquivo principal `app.py`.
        7. Clique em **Deploy**.
        8. Compartilhe o link gerado com a liderança/time.

        **Ponto de atenção:** essa versão usa exportar/importar JSON. Para histórico centralizado entre várias pessoas, o ideal é conectar no Google Sheets ou banco de dados.
        """)

    st.session_state["dados"] = dados


if __name__ == "__main__":
    main()
