---
name: "cpt-dashboard"
description: "Gera o dashboard operacional JPG 4K de um centro de distribuição para envio no WhatsApp. Use SEMPRE que o usuário colar dados do Monitor OOT, Buffer ou RADAR-V4, ou mencionar CPT, dashboard operacional, atualizar dados, gerar JPG, dados.py, gen_dash.py, \"roda o dash\", \"atualiza o dash\", \"nova rodada\" ou qualquer combinação dos três blocos de dados operacionais. Velocidade é crítica — CPTs têm prazo de minutos."
---

# Dashboard Operacional — Skill

> **Configuração inicial (fazer uma vez, na primeira execução):** esta skill precisa de uma pasta de trabalho no computador do usuário onde ficam `gen_dash.py`, `gen_dash_html.py` e o `dados.py` de cada rodada. Se a pasta ainda não foi definida em conversas anteriores, pergunte ao usuário qual pasta usar (ex: `Desktop\Dashboard_CPT`) e use esse caminho em todos os passos abaixo no lugar de `<PASTA_DE_TRABALHO>`. Depois de definida uma vez, reutilize o mesmo caminho nas próximas rodadas.

## Regra de ouro: velocidade

Nunca pergunte "posso prosseguir?". Gere, entregue, comente depois em 1 frase.

## Passo 0 — Autorização (SEMPRE primeiro, antes de qualquer outra coisa)

Chamar `mcp__cowork__request_cowork_directory` com `path: "<PASTA_DE_TRABALHO>"` (o caminho completo da pasta definida com o usuário) — isso monta a pasta automaticamente sem interação do usuário. Não espere aprovação adicional; o Cowork processa a permissão salva.

## Arquivos

- Workspace (Windows): `<PASTA_DE_TRABALHO>` (ex: `C:\Users\<usuario>\Desktop\Dashboard_CPT`)
- Bash path do workspace: **dinâmico** — usar sempre `SRC=$(ls -d /sessions/*/mnt/<NOME_DA_PASTA> 2>/dev/null | head -1)` nos scripts bash (substitua `<NOME_DA_PASTA>` pelo nome da pasta montada)
- Uploads bash path: **dinâmico** — usar `UPLOADS=$(ls -d /sessions/*/mnt/uploads 2>/dev/null | head -1)`
- `gen_dash.py` — nunca editar (já configurado com SCALE=4 → ~3600px, qualidade 4K). Deve estar dentro da pasta de trabalho — copie-o para lá na primeira configuração.
- `gen_dash_html.py` — nunca editar. Mesma pasta de trabalho.
- `dados.py` — único arquivo que muda a cada rodada

**Como escrever dados.py:** Use o Write tool com o path Windows da pasta de trabalho + `dados.py`. Faça `Read` com `limit:1` antes (satisfaz pré-condição), depois Write com o conteúdo completo.

---

## Fluxo por tipo de entrada

### Caso A — CSV do RADAR fornecido

Execute em bash (processa CSV, imprime blocos `effects_*` prontos):

```bash
python3 << 'PYEOF'
import csv, collections

def classify(p):
    if not p or not p.strip() or p.strip() == 'null': return "SEM RASTREIO"
    p = p.strip()
    if p.startswith("SO1-"): return "OUT BOUND"
    if p.startswith("SO2-") or p.startswith("PS-"): return "IN BOUND"
    if p.startswith("BF-Big") or p.startswith("Rw-BF") or p.startswith("AS6-"): return "BIG FRÁGIL"
    if "Air" in p or p.startswith("AS10-"): return "AÉREO"
    if p.startswith("Vol") or "Medusa" in p or p.startswith("AS1-") or p.startswith("AS2-"): return "VOLUMOSO"
    if p.startswith("BF-Sorter") or "Sorter" in p or p.startswith("Manga") or p.startswith("AS8-"): return "SORTER"
    if (p.startswith("BF-Est") or p.startswith("Ind") or p.startswith("InV")
        or p.startswith("Est") or p.startswith("AS4-") or p.startswith("AS9-") or p.startswith("AS11-")):
        return "ESTEIRA"
    return "SEM RASTREIO"

import glob, os
UPLOADS = glob.glob("/sessions/*/mnt/uploads")[0]
# SUBSTITUIR pelo nome real do arquivo CSV
CSV = os.path.join(UPLOADS, "NOME_DO_ARQUIVO.csv")

rows = list(csv.DictReader(open(CSV, encoding='utf-8-sig')))
AREAS = ["IN BOUND","ESTEIRA","SORTER","VOLUMOSO","AÉREO","BIG FRÁGIL","OUT BOUND"]
area_total = collections.Counter()
area_pos   = collections.defaultdict(collections.Counter)
canal_total = collections.Counter()
canal_area  = collections.defaultdict(collections.Counter)
sem_r = 0

for r in rows:
    pos = r.get("POSIÇÃO","").strip()
    if pos == 'null': pos = ''
    canal = r.get("CANAL","").strip()
    try:
        n = int(r.get("SEM HU","1") or 1)
    except:
        n = 1
    area = classify(pos)
    area_total[area] += n
    if pos: area_pos[area][pos] += n
    canal_total[canal] += n
    canal_area[canal][area] += n
    if area == "SEM RASTREIO": sem_r += n

top4 = canal_total.most_common(4)
total = sum(area_total.values())

print(f"effects_grand_total  = {total}")
print(f"effects_sem_rastreio = {sem_r}")
print("AREAS_ORDER = [\"IN BOUND\",\"ESTEIRA\",\"SORTER\",\"VOLUMOSO\",\"AÉREO\",\"BIG FRÁGIL\",\"OUT BOUND\"]")
print("effects_area_total = {" + ", ".join(f'"{a}": {area_total.get(a,0)}' for a in AREAS) + "}")
print("effects_top5 = {")
for a in AREAS:
    print(f'    "{a}": {area_pos[a].most_common(5)},')
print("}")
print("effects_top_canais = [" + ", ".join(f'("{c}",{v})' for c,v in top4) + "]")
print("effects_canal_area = {")
for c,_ in top4:
    d = dict(sorted(canal_area[c].items(), key=lambda x:-x[1]))
    print(f'    "{c}": {d},')
print("}")
PYEOF
```

Copie o output diretamente para dados.py — não transcreva manualmente.

### Caso B — Apenas imagem do RADAR (sem CSV)

Leia da imagem (bar chart "Local de Atrelamento" / "Stages") e preencha manualmente com as regras de classificação abaixo.

---

## Template dados.py (completo)

```python
kpi_time       = "HH:MM"
todos_fechados = False
cot_now     = 0.0; cot_pacotes   = 0
dot_now     = 0.0; dot_expedidos = 0
ootf_now    = 0.0
ootc_now    = 0.0
total_ciclo = 0
DOT_META = 98.5
COT_META = 99.0

# Vermelha + Onda do mesmo CPT → SOMAR antes de calcular
# sem_proc = atrib - processados; nao_enviados = atrib - expedidos; dot_cpt = expedidos/atrib*100
cpts = [
    ("CPT HH:MM", atrib, sem_proc, nao_enviados, dot_cpt_pct),
]
cpts_fechados = set()  # {"CPT HH:MM", ...}

proximo_cpt_hora  = "HH:MM"
proximo_cpt_tempo = "HH:MM"

buf_hora = "HH:MM"
buf = {
    "_1": {"Esteira": None, "Volumoso": None, "Aereo": None},
    "_2": {"Esteira": None, "Volumoso": None, "Aereo": None},
    "_3": {"Esteira": None, "Volumoso": None, "Aereo": None},
    "_4": {"Esteira": None, "Volumoso": None, "Aereo": None},
    "_5": {"Esteira": None, "Volumoso": None, "Aereo": None},
    "_6": {"Esteira": None, "Volumoso": None, "Aereo": None},
}
buf_comentarios = ["comentário 1", "comentário 2"]

effects_grand_total  = 0
effects_sem_rastreio = 0
AREAS_ORDER = ["IN BOUND","ESTEIRA","SORTER","VOLUMOSO","AÉREO","BIG FRÁGIL","OUT BOUND"]
effects_area_total = {"IN BOUND": 0,"ESTEIRA": 0,"SORTER": 0,"VOLUMOSO": 0,"AÉREO": 0,"BIG FRÁGIL": 0,"OUT BOUND": 0}
effects_top5 = {
    "IN BOUND": [], "ESTEIRA": [], "SORTER": [], "VOLUMOSO": [],
    "AÉREO": [], "BIG FRÁGIL": [], "OUT BOUND": [],
}
effects_top_canais = [("—",0)]
effects_canal_area = {}
```

---

## Regras de parsing — Monitor OOT

- `kpi_time` = hora da atualização (ex: "10:15"). Se não houver um horário explícito no texto colado, use a linha em destaque ("bold") da tabela de pendências do RADAR como referência do horário atual, ou pergunte ao usuário — não deduza pelo contador "Tempo para o fechamento", pois ele pode não refletir o horário real.
- `total_ciclo`, `cot_now/cot_pacotes`, `dot_now/dot_expedidos`, `ootf_now`, `ootc_now` — lidos diretamente quando houver um cabeçalho global; se só houver COT/DOT por CPT, calcule a soma agregada de todos os CPTs (Vermelha+Onda) e avise que é uma estimativa, não um valor oficial.
- Por CPT: **Vermelha + Onda do mesmo CPT → somar** atrib, processados, expedidos
- `cpts_fechados`: CPTs marcados "FECHADO" (com ou sem atraso) no texto colado. Um CPT sem nenhum rótulo de status e sem o aviso "Revise os pacotes..." geralmente já foi fechado no horário.
- DOT CPT e barra só aparecem para CPTs em `cpts_fechados`

## Regras de parsing — Buffer

- `_1`–`_6`: Esteira/Volumoso/Aereo (None se área não opera nessa linha)
- Zero explícito ("zerado") → 0, não None
- Área não mencionada na mesma rodada/dia → manter valor anterior (ler dados.py antes). Se for um dia novo, não herdar valores do dia anterior.
- `buf_comentarios`: totais + anomalias (Troca de Transportadora, Gaylord, SEM ETA)

## Classificação RADAR (Caso B)

| Prefixo/padrão | Área |
|---|---|
| `SO1-` | OUT BOUND |
| `SO2-`, `PS-` | IN BOUND |
| `BF-Big`, `Rw-BF`, `AS6-` | BIG FRÁGIL |
| `BF-Air`, `Air`, `AS10-` | AÉREO |
| `Vol`, `Medusa`, `AS1-`, `AS2-` | VOLUMOSO |
| `BF-Sorter`, `Sorter`, `Manga`, `AS8-` | SORTER |
| `BF-Est`, `Ind*`, `InV`, `Est`, `AS4-`, `AS9-`, `AS11-` | ESTEIRA |
| vazio | SEM RASTREIO |

---

## Gerar JPG 4K

```bash
SRC=$(ls -d /sessions/*/mnt/<NOME_DA_PASTA> 2>/dev/null | head -1)

TMPDIR="/tmp/gen_$(date +%s)"
mkdir -p "$TMPDIR"
cp "$SRC/gen_dash.py" "$SRC/dados.py" "$TMPDIR/"
sed -i "s|^out=.*|out=\"$TMPDIR/dashboard.jpg\"|" "$TMPDIR/gen_dash.py"
cd "$TMPDIR" && python3 gen_dash.py && echo "JPG OK"

HORA=$(python3 -c "import sys;sys.path.insert(0,'$SRC');import dados;print(dados.kpi_time.replace(':',''))")
NOME="dashboard_$(date +%d%b | tr '[:upper:]' '[:lower:]')_${HORA}.jpg"
cp "$TMPDIR/dashboard.jpg" "$SRC/$NOME" && echo "Salvo: $SRC/$NOME"
```

## Entregar

Chamar `present_files` com apenas o JPG:
- `<PASTA_DE_TRABALHO>\<NOME>.jpg`

Comentário final: 1 frase com horário + CPTs fechados + destaque do RADAR.
