const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');
const QRCode = require('qrcode');
const cookieParser = require('cookie-parser');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const STATE = {
  phase: 1,
  businessCases: [
    { id: 'gc', name: 'Finding the client of tomorrow', color: '#dc2626' },
    { id: 'dl', name: 'Turning a prospect into a client', color: '#b91c1c' },
    { id: 'un', name: 'Upskilling the Underperforming Dealer', color: '#ef4444' }
  ],
  teams: [
    { id: 'team1',  name: 'Team 1',  caseId: 'gc' },
    { id: 'team2',  name: 'Team 2',  caseId: 'gc' },
    { id: 'team3',  name: 'Team 3',  caseId: 'gc' },
    { id: 'team4',  name: 'Team 4',  caseId: 'gc' },
    { id: 'team5',  name: 'Team 5',  caseId: 'dl' },
    { id: 'team6',  name: 'Team 6',  caseId: 'dl' },
    { id: 'team7',  name: 'Team 7',  caseId: 'dl' },
    { id: 'team8',  name: 'Team 8',  caseId: 'dl' },
    { id: 'team9',  name: 'Team 9',  caseId: 'un' },
    { id: 'team10', name: 'Team 10', caseId: 'un' },
    { id: 'team11', name: 'Team 11', caseId: 'un' },
    { id: 'team12', name: 'Team 12', caseId: 'un' }
  ],
  judges: [
    { id: 'j1', name: 'Anna Rossi',    assignedTeams: ['team1','team2','team3','team4'] },
    { id: 'j2', name: 'Bruno Bianchi', assignedTeams: ['team1','team2','team3','team4'] },
    { id: 'j3', name: 'Carla Conti',   assignedTeams: ['team5','team6','team7','team8'] },
    { id: 'j4', name: 'David De Luca', assignedTeams: ['team5','team6','team7','team8'] },
    { id: 'j5', name: 'Elena Ferrari', assignedTeams: ['team9','team10','team11','team12'] },
    { id: 'j6', name: 'Franco Gallo',  assignedTeams: ['team9','team10','team11','team12'] }
  ],
  dimensions: ['Creativity', 'Feasibility', 'Effectiveness', 'Collaboration'],
  votes: {},
  phase2votes: {},
  winners: []
};

const PHASE2_DIMENSIONS = ['Creativity', 'Feasibility', 'Effectiveness'];

function computeRankings() {
  return STATE.businessCases.map(bc => {
    const bcTeams = STATE.teams.filter(t => t.caseId === bc.id);
    const ranked = bcTeams.map(team => {
      let total = 0, count = 0;
      const dimTotals = {};
      STATE.dimensions.forEach(d => { dimTotals[d] = 0; });
      STATE.judges.forEach(judge => {
        const key = `${judge.id}_${team.id}`;
        if (STATE.votes[key]) {
          const v = STATE.votes[key];
          STATE.dimensions.forEach(d => { dimTotals[d] += v[d] || 0; });
          total += STATE.dimensions.reduce((sum, d) => sum + (v[d] || 0), 0);
          count++;
        }
      });
      const avg = count > 0 ? total / count : 0;
      const dimAvg = count > 0
        ? Object.fromEntries(STATE.dimensions.map(d => [d, dimTotals[d]/count]))
        : Object.fromEntries(STATE.dimensions.map(d => [d, 0]));
      return { ...team, avg, dimAvg, voteCount: count };
    });
    ranked.sort((a, b) => b.avg - a.avg);
    return { ...bc, teams: ranked };
  });
}

function computePhase2Rankings() {
  // phase2votes[voterId][teamId] = { Creativity, Feasibility, Effectiveness, Collaboration }
  return STATE.winners.map(id => {
    const team = STATE.teams.find(t => t.id === id);
    const bc = STATE.businessCases.find(b => b.id === team.caseId);
    let total = 0, count = 0;
    const dimTotals = {};
    STATE.dimensions.forEach(d => { dimTotals[d] = 0; });
    Object.values(STATE.phase2votes).forEach(voterScores => {
      if (voterScores[id]) {
        const s = voterScores[id];
        STATE.dimensions.forEach(d => { dimTotals[d] += s[d] || 0; });
        total += STATE.dimensions.reduce((sum, d) => sum + (s[d] || 0), 0);
        count++;
      }
    });
    const avg = count > 0 ? total / count : 0;
    const dimAvg = count > 0
      ? Object.fromEntries(STATE.dimensions.map(d => [d, dimTotals[d]/count]))
      : Object.fromEntries(STATE.dimensions.map(d => [d, 0]));
    return { ...team, avg, dimAvg, voteCount: count, caseName: bc.name, caseColor: bc.color };
  }).sort((a, b) => b.avg - a.avg);
}

function broadcast() {
  const completedP2 = Object.values(STATE.phase2votes).filter(v =>
    STATE.winners.length > 0 && STATE.winners.every(id => v[id] && STATE.dimensions.some(d => v[id][d]))
  ).length;
  io.emit('update', {
    phase: STATE.phase,
    rankings: computeRankings(),
    phase2Rankings: computePhase2Rankings(),
    winners: STATE.winners,
    totalPhase2Votes: completedP2
  });
}

function judgePageHtml(judge, teams, existingVotes, flash) {
  const css = `
*{margin:0;padding:0;box-sizing:border-box}
body{background:#f8fafc;font-family:'Segoe UI',system-ui,sans-serif;min-height:100vh;padding-bottom:60px}
header{background:#080c14;color:#fff;padding:20px;text-align:center}
header h1{font-size:1.1rem;font-weight:700}
header p{color:rgba(255,255,255,0.4);font-size:0.8rem;margin-top:4px}
.badge{display:inline-block;margin-top:8px;background:rgba(255,255,255,0.12);padding:4px 16px;border-radius:20px;font-size:0.85rem;font-weight:600}
.flash{background:#dcfce7;color:#15803d;padding:12px 20px;text-align:center;font-weight:600;font-size:0.9rem}
.container{max-width:540px;margin:0 auto;padding:20px}
.team-card{background:#fff;border-radius:16px;box-shadow:0 2px 8px rgba(0,0,0,0.07);margin-bottom:28px;overflow:hidden}
.team-header{padding:16px 20px;display:flex;align-items:center;gap:12px;border-bottom:3px solid #f1f5f9}
.dot{width:12px;height:12px;border-radius:50%;flex-shrink:0}
.team-name{font-size:1rem;font-weight:700;color:#1e293b}
.team-case{font-size:0.75rem;margin-top:2px}
.voted{margin-left:auto;background:#dcfce7;color:#16a34a;font-size:0.7rem;font-weight:700;padding:3px 10px;border-radius:20px}
.dims{padding:16px 20px}
.dim{margin-bottom:20px}
.dim-title{font-size:0.85rem;font-weight:700;color:#475569;margin-bottom:10px;text-transform:uppercase;letter-spacing:0.5px}
.radio-row{display:flex;gap:8px}
.radio-row input[type=radio]{display:none}
.radio-row label{flex:1;height:50px;border-radius:10px;border:2px solid #e2e8f0;display:flex;align-items:center;justify-content:center;font-size:1.1rem;font-weight:700;color:#94a3b8;cursor:pointer;transition:all 0.1s}
.radio-row input[type=radio]:checked + label{color:#fff;border-color:currentColor}
.submit{display:block;width:100%;padding:16px;border:none;border-radius:12px;font-size:1rem;font-weight:700;cursor:pointer;color:#fff;margin-top:8px;letter-spacing:0.5px;text-transform:uppercase}
.score-desc{display:flex;gap:8px;margin-top:6px}
.score-desc span{flex:1;font-size:0.65rem;color:#475569;text-align:center;line-height:1.3;background:#f1f5f9;border-radius:4px;padding:4px 2px}`;

  const teamsHtml = teams.map(team => {
    const ex = existingVotes[team.id] || {};
    const voted = STATE.dimensions.every(d => ex[d]);
    const dimsHtml = STATE.dimensions.map(dim => {
      const cur = ex[dim] || 0;
      const radios = [1,2,3,4].map(n =>
        `<input type="radio" name="${dim}" id="r-${team.id}-${dim}-${n}" value="${n}"${cur===n?' checked':''}>`+
        `<label for="r-${team.id}-${dim}-${n}" style="color:${team.caseColor}">${n}</label>`
      ).join('');
      const descHtml = '<div class="score-desc"><span>Not met</span><span>Met</span><span>Above expectation</span><span>Exceed expectations</span></div>';
      return `<div class="dim"><div class="dim-title">${dim}</div><div class="radio-row">${radios}</div>${descHtml}</div>`;
    }).join('');

    return `<div class="team-card">
      <div class="team-header" style="border-bottom-color:${team.caseColor}22">
        <div class="dot" style="background:${team.caseColor}"></div>
        <div><div class="team-name">${team.name}</div><div class="team-case" style="color:${team.caseColor}">${team.caseName}</div></div>
        ${voted ? '<span class="voted">Voted</span>' : ''}
      </div>
      <form class="dims" method="POST" action="/judge/${judge.id}/vote/${team.id}">
        ${dimsHtml}
        <button class="submit" style="background:${team.caseColor}">${voted ? 'Update Vote' : 'Submit Vote'}</button>
      </form>
    </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Vote — ${judge.name}</title>
<style>${css}</style>
</head>
<body>
<header>
  <h1>Workshop Challenge</h1>
  <p>Judge Voting Panel</p>
  <div class="badge">${judge.name}</div>
</header>
${flash ? `<div class="flash">✓ ${flash}</div>` : ''}
<div class="container">
  ${STATE.phase === 2 ? '<p style="text-align:center;padding:60px 20px;color:#64748b">Phase 1 is closed.</p>' : teamsHtml}
</div>
</body>
</html>`;
}

app.get('/judge/:id', (req, res) => {
  const judge = STATE.judges.find(j => j.id === req.params.id);
  if (!judge) return res.status(404).send('<h2>Judge not found</h2>');
  const teams = judge.assignedTeams.map(tid => {
    const t = STATE.teams.find(t => t.id === tid);
    const bc = STATE.businessCases.find(b => b.id === t.caseId);
    return { ...t, caseName: bc.name, caseColor: bc.color };
  });
  const existingVotes = {};
  judge.assignedTeams.forEach(tid => {
    const key = `${judge.id}_${tid}`;
    if (STATE.votes[key]) existingVotes[tid] = STATE.votes[key];
  });
  res.send(judgePageHtml(judge, teams, existingVotes, req.query.ok));
});

app.post('/judge/:judgeId/vote/:teamId', express.urlencoded({ extended: false }), (req, res) => {
  const judge = STATE.judges.find(j => j.id === req.params.judgeId);
  if (!judge || !judge.assignedTeams.includes(req.params.teamId)) return res.status(400).send('Invalid');
  const scores = {};
  STATE.dimensions.forEach(d => { scores[d] = parseInt(req.body[d]) || 0; });
  if (STATE.dimensions.some(d => !scores[d])) return res.redirect(`/judge/${judge.id}?ok=Please+score+all+3+dimensions`);
  STATE.votes[`${judge.id}_${req.params.teamId}`] = scores;
  broadcast();
  const team = STATE.teams.find(t => t.id === req.params.teamId);
  res.redirect(`/judge/${judge.id}?ok=Vote+saved+for+${encodeURIComponent(team.name)}`);
});

app.get('/bestinclass', (req, res) => {
  // Compute per-dimension average for every team using Phase 1 votes
  const teamScores = STATE.teams.map(team => {
    const bc = STATE.businessCases.find(b => b.id === team.caseId);
    const dimTotals = {};
    let count = 0;
    STATE.dimensions.forEach(d => { dimTotals[d] = 0; });
    STATE.judges.forEach(judge => {
      const v = STATE.votes[`${judge.id}_${team.id}`];
      if (v) {
        STATE.dimensions.forEach(d => { dimTotals[d] += v[d] || 0; });
        count++;
      }
    });
    const dimAvg = {};
    STATE.dimensions.forEach(d => { dimAvg[d] = count ? +(dimTotals[d] / count).toFixed(2) : 0; });
    return { ...team, caseName: bc.name, caseColor: bc.color, dimAvg, voteCount: count };
  });

  // For each dimension find the winner (highest avg)
  const bestByDim = STATE.dimensions.map(dim => {
    const sorted = [...teamScores].sort((a, b) => b.dimAvg[dim] - a.dimAvg[dim]);
    return { dim, teams: sorted };
  });

  const css = `
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0e1a;font-family:'Segoe UI',system-ui,sans-serif;min-height:100vh;padding-bottom:40px;color:#fff}
header{background:#080c14;padding:24px 20px;text-align:center;border-bottom:2px solid #1e293b}
header h1{font-size:1.4rem;font-weight:800;letter-spacing:1px;text-transform:uppercase}
header p{color:rgba(255,255,255,0.4);font-size:0.8rem;margin-top:6px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px;max-width:1200px;margin:28px auto;padding:0 20px}
.dim-card{background:#111827;border-radius:18px;overflow:hidden;border:1px solid #1e293b}
.dim-header{padding:14px 20px;text-align:center;font-size:0.75rem;font-weight:800;letter-spacing:2px;text-transform:uppercase;background:#0f172a}
.winner-block{padding:20px;text-align:center;border-bottom:1px solid #1e293b}
.winner-label{font-size:0.65rem;font-weight:700;letter-spacing:2px;color:rgba(255,255,255,0.4);text-transform:uppercase;margin-bottom:8px}
.winner-trophy{font-size:2rem;margin-bottom:6px}
.winner-name{font-size:1.15rem;font-weight:800;margin-bottom:2px}
.winner-case{font-size:0.72rem;color:rgba(255,255,255,0.45);margin-bottom:10px}
.winner-score{font-size:2.8rem;font-weight:900;line-height:1}
.winner-score span{font-size:0.9rem;font-weight:500;color:rgba(255,255,255,0.4)}
.team-list{padding:12px 16px}
.team-row{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #1a2234}
.team-row:last-child{border-bottom:none}
.rank{font-size:0.75rem;font-weight:700;color:rgba(255,255,255,0.3);width:18px;text-align:center;flex-shrink:0}
.dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.tname{flex:1;font-size:0.82rem;font-weight:600;color:rgba(255,255,255,0.85)}
.tcase{font-size:0.65rem;color:rgba(255,255,255,0.35)}
.score-bar-wrap{width:80px;flex-shrink:0}
.score-bar-bg{background:#1e293b;border-radius:4px;height:6px;overflow:hidden}
.score-bar-fill{height:6px;border-radius:4px}
.score-val{font-size:0.78rem;font-weight:700;text-align:right;margin-top:3px}
.no-votes{padding:20px;text-align:center;color:rgba(255,255,255,0.3);font-size:0.85rem}
`;

  const cardsHtml = bestByDim.map(({ dim, teams }) => {
    const winner = teams[0];
    const hasVotes = winner.voteCount > 0;
    const winnerHtml = hasVotes ? `
      <div class="winner-block">
        <div class="winner-label">Best in Class</div>
        <div class="winner-trophy">🏆</div>
        <div class="winner-name" style="color:${winner.caseColor}">${winner.name}</div>
        <div class="winner-case">${winner.caseName}</div>
        <div class="winner-score" style="color:${winner.caseColor}">${winner.dimAvg[dim].toFixed(1)}<span> / 4</span></div>
      </div>` : '<div class="no-votes">No votes yet</div>';

    const rowsHtml = teams.map((t, i) => {
      const pct = (t.dimAvg[dim] / 4) * 100;
      return `<div class="team-row">
        <span class="rank">${i + 1}</span>
        <div class="dot" style="background:${t.caseColor}"></div>
        <div style="flex:1;min-width:0">
          <div class="tname">${t.name}</div>
          <div class="tcase">${t.caseName}</div>
        </div>
        <div class="score-bar-wrap">
          <div class="score-bar-bg"><div class="score-bar-fill" style="width:${pct}%;background:${t.caseColor}"></div></div>
          <div class="score-val" style="color:${t.caseColor}">${t.voteCount ? t.dimAvg[dim].toFixed(1) : '—'}</div>
        </div>
      </div>`;
    }).join('');

    return `<div class="dim-card">
      <div class="dim-header" style="color:${winner.caseColor || '#94a3b8'}">${dim}</div>
      ${winnerHtml}
      <div class="team-list">${rowsHtml}</div>
    </div>`;
  }).join('');

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Best in Class</title>
<style>${css}</style>
</head>
<body>
<header>
  <h1>Best in Class</h1>
  <p>Phase 1 — Top scorer per category</p>
</header>
<div class="grid">${cardsHtml}</div>
<script>setTimeout(()=>location.reload(),30000)</script>
</body>
</html>`);
});

app.get('/display', (req, res) => res.sendFile(path.join(__dirname, 'public', 'display.html')));
app.get('/admin', async (req, res) => {
  const ip = getLocalIP();
  const base = req.query.publicUrl || process.env.PUBLIC_URL || `http://${ip}:${PORT}`;

  const qrImages = await Promise.all(STATE.judges.map(async j => {
    const url = `${base}/judge/${j.id}`;
    const dataUrl = await QRCode.toDataURL(url, { width: 200, margin: 2, color: { dark: '#0f172a', light: '#ffffff' } });
    const teams = j.assignedTeams.map(tid => STATE.teams.find(t => t.id === tid)?.name).join(', ');
    return { judge: j, url, dataUrl, teams };
  }));

  const phase2Url = `${base}/vote`;
  const phase2QrDataUrl = await QRCode.toDataURL(phase2Url, { width: 250, margin: 2, color: { dark: '#0f172a', light: '#ffffff' } });
  const phase2Html = `
    <div class="section" style="border:2px solid #fbbf24">
      <h2 style="color:#b45309">Phase 2 — Grand Final Vote</h2>
      <p style="font-size:0.8rem;color:#64748b;margin-bottom:16px">Condividi questo QR code con tutti (giudici + team). Un voto per dispositivo.</p>
      <div style="display:flex;align-items:center;gap:24px;flex-wrap:wrap">
        <img src="${phase2QrDataUrl}" width="200" height="200" style="border-radius:8px">
        <div>
          <div style="font-size:0.75rem;color:#64748b;margin-bottom:4px">URL fase 2</div>
          <div style="font-size:0.9rem;color:#1e293b;font-weight:600;word-break:break-all">${phase2Url}</div>
          ${STATE.winners.length > 0 ? `
          <div style="margin-top:16px;font-size:0.8rem;color:#64748b">Finalisti:</div>
          ${STATE.winners.map(id => {
            const t = STATE.teams.find(t => t.id === id);
            const bc = STATE.businessCases.find(b => b.id === t.caseId);
            return `<div style="font-size:0.9rem;font-weight:600;color:${bc.color};margin-top:4px">• ${t.name} <span style="color:#94a3b8;font-weight:400">(${bc.name})</span></div>`;
          }).join('')}` : `<div style="margin-top:12px;font-size:0.8rem;color:#94a3b8;font-style:italic">Finalisti non ancora impostati</div>`}
        </div>
      </div>
    </div>`;

  const judgesHtml = qrImages.map(({ judge, url, dataUrl, teams }) => `
    <div class="judge-card">
      <h3>${judge.name}</h3>
      <div class="judge-link">${url}</div>
      <div class="judge-teams">Teams: ${teams}</div>
      <div class="qr-container">
        <img src="${dataUrl}" width="180" height="180" style="border-radius:8px;display:block">
      </div>
    </div>`).join('');

  const winnersHtml = STATE.businessCases.map(bc => {
    const bcTeams = STATE.teams.filter(t => t.caseId === bc.id);
    return `<div style="margin-bottom:16px">
      <div style="font-size:0.75rem;font-weight:700;color:${bc.color};margin-bottom:6px;text-transform:uppercase">${bc.name}</div>
      <select id="winner-${bc.id}" onchange="selW['${bc.id}']=this.value">
        <option value="">Select winner...</option>
        ${bcTeams.map(t => `<option value="${t.id}">${t.name}</option>`).join('')}
      </select>
    </div>`;
  }).join('');

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Admin — Workshop Voting</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#f1f5f9;font-family:'Segoe UI',system-ui,sans-serif;padding:24px}
h1{font-size:1.4rem;font-weight:800;color:#0f172a;margin-bottom:4px}
.sub{color:#64748b;font-size:0.85rem;margin-bottom:20px}
.net-info{background:#dbeafe;border-radius:10px;padding:10px 16px;margin-bottom:20px;font-size:0.85rem;color:#1e40af}
.net-info strong{font-size:1rem}
.status-bar{background:#0f172a;color:#fff;border-radius:12px;padding:16px 20px;display:flex;gap:24px;flex-wrap:wrap;margin-bottom:20px}
.stat-label{font-size:0.7rem;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:1px}
.stat-val{font-size:1.4rem;font-weight:800}
.section{background:#fff;border-radius:16px;padding:24px;margin-bottom:20px;box-shadow:0 1px 4px rgba(0,0,0,0.06)}
.section h2{font-size:0.9rem;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:1px;margin-bottom:16px}
.phase-controls{display:flex;gap:12px;flex-wrap:wrap}
.phase-btn{padding:10px 20px;border-radius:10px;border:2px solid #e2e8f0;background:#fff;font-size:0.85rem;font-weight:600;cursor:pointer;color:#475569}
.phase-btn.active{background:#0f172a;border-color:#0f172a;color:#fff}
.phase-btn.danger{border-color:#fca5a5;color:#dc2626}
.phase-btn.danger:hover{background:#dc2626;color:#fff;border-color:#dc2626}
.judges-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px}
.judge-card{border:1px solid #e2e8f0;border-radius:12px;padding:16px;background:#fff}
.judge-card h3{font-size:0.95rem;font-weight:700;color:#1e293b;margin-bottom:4px}
.judge-link{font-size:0.72rem;color:#3b82f6;word-break:break-all;margin-bottom:8px}
.judge-teams{font-size:0.75rem;color:#64748b;margin-bottom:12px;line-height:1.6}
.qr-container{display:flex;justify-content:center}
select{padding:8px 12px;border-radius:8px;border:1px solid #e2e8f0;font-size:0.85rem;width:100%;margin-bottom:8px}
.save-btn,.action-btn{padding:10px 20px;border:none;border-radius:10px;font-size:0.85rem;font-weight:700;cursor:pointer}
.save-btn{background:#0f172a;color:#fff}
.vote-row{display:flex;align-items:center;gap:12px;margin-bottom:8px;font-size:0.8rem}
.vote-label{width:140px;color:#475569}
.vote-bar-bg{flex:1;height:6px;background:#e2e8f0;border-radius:3px;overflow:hidden}
.vote-bar-fill{height:100%;border-radius:3px}
.vote-count{width:40px;text-align:right;color:#94a3b8;font-weight:600}
</style>
</head>
<body>
<h1>Admin Panel</h1>
<p class="sub">Workshop Voting — Control Center</p>
<div class="net-info">
  📡 Base URL per QR code: <strong>${base}</strong><br><br>
  <div style="display:flex;gap:8px;margin-top:4px">
    <input id="publicUrlInput" type="text" placeholder="Incolla URL Cloudflare es. https://xxxx.trycloudflare.com"
      style="flex:1;padding:8px 12px;border-radius:8px;border:1px solid #93c5fd;font-size:0.85rem"
      value="${req.query.publicUrl || ''}">
    <button onclick="applyUrl()" style="padding:8px 16px;background:#1d4ed8;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer">Aggiorna QR</button>
  </div>
</div>
<script>
function applyUrl() {
  var url = document.getElementById('publicUrlInput').value.trim().replace(/\\/$/, '');
  if (url) window.location.href = '/admin?publicUrl=' + encodeURIComponent(url);
  else window.location.href = '/admin';
}
document.getElementById('publicUrlInput').addEventListener('keydown', function(e){ if(e.key==='Enter') applyUrl(); });
</script>

<div class="status-bar">
  <div><div class="stat-label">Phase</div><div class="stat-val" id="statPhase">${STATE.phase}</div></div>
  <div><div class="stat-label">Phase 2 Votes</div><div class="stat-val" id="statP2">${Object.keys(STATE.phase2votes).length}</div></div>
</div>

<div class="section">
  <h2>Phase Control</h2>
  <div class="phase-controls">
    <button class="phase-btn ${STATE.phase===1?'active':''}" onclick="setPhase(1)">Phase 1 — Semifinal</button>
    <button class="phase-btn ${STATE.phase===2?'active':''}" onclick="setPhase(2)">Phase 2 — Grand Final</button>
    <button class="phase-btn danger" onclick="resetAll()">Reset Everything</button>
  </div>
</div>

<div class="section">
  <h2>Set Phase 2 Finalists</h2>
  <p style="font-size:0.8rem;color:#64748b;margin-bottom:16px">Select one winner per business case</p>
  <div id="winnersContainer">${winnersHtml}</div>
  <button class="save-btn" onclick="saveWinners()">Save Finalists</button>
</div>

<div class="section">
  <h2>Vote Progress (Phase 1)</h2>
  <div id="voteProgress">Loading...</div>
</div>

${phase2Html}

<div class="section">
  <h2>Judge Links & QR Codes</h2>
  <div class="judges-grid">${judgesHtml}</div>
</div>

<script src="/socket.io/socket.io.js"></script>
<script>
var selW = {};
var socket = io();
socket.on('update', function(data) {
  if (data.phase) document.getElementById('statPhase').textContent = data.phase;
  if (data.totalPhase2Votes !== undefined) document.getElementById('statP2').textContent = data.totalPhase2Votes;
  if (data.rankings) renderProgress(data.rankings);
});

fetch('/api/state').then(function(r){return r.json();}).then(function(d){ renderProgress(d.rankings); });

function renderProgress(rankings) {
  var html = '';
  rankings.forEach(function(bc) {
    html += '<div style="margin-bottom:16px"><div style="font-size:0.75rem;font-weight:700;color:'+bc.color+';margin-bottom:8px;text-transform:uppercase">'+bc.name+'</div>';
    bc.teams.forEach(function(t) {
      html += '<div class="vote-row"><div class="vote-label">'+t.name+'</div><div class="vote-bar-bg"><div class="vote-bar-fill" style="width:'+(t.voteCount/2*100)+'%;background:'+bc.color+'"></div></div><div class="vote-count">'+t.voteCount+'/2</div></div>';
    });
    html += '</div>';
  });
  document.getElementById('voteProgress').innerHTML = html;
}

function setPhase(p) {
  fetch('/api/admin/phase',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phase:p})})
    .then(function(){ location.reload(); });
}

function saveWinners() {
  var winners = Object.values(selW).filter(Boolean);
  if (!winners.length) { alert('Select at least one finalist'); return; }
  fetch('/api/admin/winners',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({winners:winners})})
    .then(function(){ alert('Finalists saved!'); });
}

function resetAll() {
  if (!confirm('Reset all votes?')) return;
  fetch('/api/admin/reset',{method:'POST'}).then(function(){ location.reload(); });
}
</script>
</body>
</html>`);
});
app.get('/test', (req, res) => res.send('<h1 style="font-size:3rem;padding:40px;font-family:sans-serif">SERVER OK ✓</h1><p style="padding:0 40px;font-size:1.5rem;font-family:sans-serif">Il server funziona!</p>'));
app.get('/vote', (req, res) => {
  let voterId = req.cookies.voterId;
  if (!voterId) {
    voterId = uuidv4();
    res.cookie('voterId', voterId, { maxAge: 86400000, httpOnly: true });
  }

  if (STATE.phase !== 2 || STATE.winners.length === 0) {
    return res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Final Vote</title><style>*{margin:0;padding:0;box-sizing:border-box}body{background:#080c14;color:#fff;font-family:'Segoe UI',system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:20px}h2{font-size:1.3rem;margin-bottom:8px}p{color:rgba(255,255,255,0.4)}</style></head>
<body><div><h2>Not open yet</h2><p>The final vote hasn't started.<br>Check back soon!</p></div></body></html>`);
  }

  const finalists = STATE.winners.map(id => {
    const team = STATE.teams.find(t => t.id === id);
    const bc = STATE.businessCases.find(b => b.id === team.caseId);
    return { ...team, caseName: bc.name, caseColor: bc.color };
  });

  const existingVotes = STATE.phase2votes[voterId] || {};
  const allVoted = finalists.every(f => existingVotes[f.id] && PHASE2_DIMENSIONS.some(d => existingVotes[f.id][d]));

  const css = `*{margin:0;padding:0;box-sizing:border-box}body{background:#f8fafc;font-family:'Segoe UI',system-ui,sans-serif;min-height:100vh;padding-bottom:40px}header{background:#0a0a0a;color:#fff;padding:20px;text-align:center;border-bottom:3px solid #dc2626}header h1{font-size:1.1rem;font-weight:700}header p{color:rgba(255,255,255,0.4);font-size:0.8rem;margin-top:4px}.container{max-width:540px;margin:0 auto;padding:20px}.confirm-banner{background:#0a0a0a;color:#fff;border-radius:16px;padding:24px 20px;margin-bottom:24px;text-align:center}.confirm-banner h2{font-size:1.2rem;font-weight:700;margin-bottom:4px}.confirm-banner p{font-size:0.85rem;color:rgba(255,255,255,0.5);margin-bottom:16px}.confirm-row{display:flex;align-items:center;gap:12px;padding:10px 0;border-top:1px solid #1a1a1a}.confirm-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}.confirm-name{flex:1;font-size:0.9rem;font-weight:600;text-align:left}.confirm-scores{display:flex;gap:8px}.confirm-score{text-align:center;min-width:36px}.confirm-score-val{font-size:1rem;font-weight:800}.confirm-score-lbl{font-size:0.6rem;color:rgba(255,255,255,0.4);text-transform:uppercase}.edit-btn{display:block;width:100%;padding:12px;border:2px solid #dc2626;border-radius:12px;font-size:0.9rem;font-weight:700;cursor:pointer;color:#dc2626;background:transparent;margin-top:16px;letter-spacing:0.5px;text-transform:uppercase}.team-card{background:#fff;border-radius:16px;box-shadow:0 2px 8px rgba(0,0,0,0.07);margin-bottom:28px;overflow:hidden}.team-header{padding:16px 20px;display:flex;align-items:center;gap:12px;border-bottom:3px solid #f1f5f9}.dot{width:12px;height:12px;border-radius:50%;flex-shrink:0}.team-name{font-size:1rem;font-weight:700;color:#1e293b}.team-case{font-size:0.75rem;margin-top:2px}.voted{margin-left:auto;background:#fee2e2;color:#dc2626;font-size:0.7rem;font-weight:700;padding:3px 10px;border-radius:20px}.dims{padding:16px 20px}.dim{margin-bottom:20px}.dim-title{font-size:0.85rem;font-weight:700;color:#475569;margin-bottom:10px;text-transform:uppercase;letter-spacing:0.5px}.radio-row{display:flex;gap:8px}.radio-row input[type=radio]{display:none}.radio-row label{flex:1;height:50px;border-radius:10px;border:2px solid #e2e8f0;display:flex;align-items:center;justify-content:center;font-size:1.1rem;font-weight:700;color:#94a3b8;cursor:pointer;transition:all 0.1s}.radio-row input[type=radio]:checked+label{color:#fff;border-color:currentColor}.submit{display:block;width:100%;padding:16px;border:none;border-radius:12px;font-size:1rem;font-weight:700;cursor:pointer;color:#fff;background:#dc2626;margin-top:8px;letter-spacing:0.5px;text-transform:uppercase}.score-desc{display:flex;gap:8px;margin-top:6px}.score-desc span{flex:1;font-size:0.65rem;color:#475569;text-align:center;line-height:1.3;background:#f1f5f9;border-radius:4px;padding:4px 2px}`;

  if (allVoted && req.query.ok) {
    const confirmRows = finalists.map(team => {
      const ex = existingVotes[team.id];
      return `<div class="confirm-row">
        <div class="confirm-dot" style="background:${team.caseColor}"></div>
        <div class="confirm-name" style="color:#fff">${team.name}</div>
        <div class="confirm-scores">
          ${PHASE2_DIMENSIONS.map(d => `<div class="confirm-score"><div class="confirm-score-val" style="color:${team.caseColor}">${ex[d]}</div><div class="confirm-score-lbl">${d.slice(0,3)}</div></div>`).join('')}
        </div>
      </div>`;
    }).join('');

    return res.send(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Grand Final Vote</title><style>${css}</style></head>
<body>
<header><h1>Grand Final</h1><p>Score all 3 finalists — Creativity, Feasibility, Effectiveness</p></header>
<div class="container">
  <div class="confirm-banner">
    <h2>Votes Saved!</h2>
    <p>Your scores have been recorded</p>
    ${confirmRows}
    <form method="GET" action="/vote"><button class="edit-btn">Edit My Votes</button></form>
  </div>
</div></body></html>`);
  }

  const teamsHtml = finalists.map(team => {
    const ex = existingVotes[team.id] || {};
    const voted = PHASE2_DIMENSIONS.every(d => ex[d]);
    const dimsHtml = PHASE2_DIMENSIONS.map(dim => {
      const cur = ex[dim] || 0;
      const radios = [1,2,3,4].map(n =>
        `<input type="radio" name="${team.id}_${dim}" id="r-${team.id}-${dim}-${n}" value="${n}"${cur===n?' checked':''}>`+
        `<label for="r-${team.id}-${dim}-${n}" style="color:${team.caseColor}">${n}</label>`
      ).join('');
      const descHtml = '<div class="score-desc"><span>Not met</span><span>Met</span><span>Above expectations</span><span>Exceed expectations</span></div>';
      return `<div class="dim"><div class="dim-title">${dim}</div><div class="radio-row">${radios}</div>${descHtml}</div>`;
    }).join('');
    return `<div class="team-card">
      <div class="team-header" style="border-bottom-color:${team.caseColor}33">
        <div class="dot" style="background:${team.caseColor}"></div>
        <div><div class="team-name">${team.name}</div><div class="team-case" style="color:${team.caseColor}">${team.caseName}</div></div>
        ${voted ? '<span class="voted">Voted</span>' : ''}
      </div>
      <div class="dims">${dimsHtml}</div>
    </div>`;
  }).join('');

  res.send(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Grand Final Vote</title><style>${css}</style></head>
<body>
<header><h1>Grand Final</h1><p>Score all 3 finalists — Creativity, Feasibility, Effectiveness</p></header>
<div class="container">
<form method="POST" action="/vote">
${teamsHtml}
<button class="submit">${allVoted ? 'Update Votes' : 'Submit All Votes'}</button>
</form>
</div></body></html>`);
});

app.post('/vote', express.urlencoded({ extended: false }), (req, res) => {
  let voterId = req.cookies.voterId;
  if (!voterId) {
    voterId = uuidv4();
    res.cookie('voterId', voterId, { maxAge: 86400000, httpOnly: true });
  }
  const voterScores = STATE.phase2votes[voterId] || {};
  STATE.winners.forEach(teamId => {
    const scores = {};
    PHASE2_DIMENSIONS.forEach(d => {
      scores[d] = parseInt(req.body[`${teamId}_${d}`]) || 0;
    });
    if (PHASE2_DIMENSIONS.every(d => scores[d] > 0)) {
      voterScores[teamId] = scores;
    }
  });
  STATE.phase2votes[voterId] = voterScores;
  broadcast();
  res.redirect('/vote?ok=Votes+saved!');
});
app.get('/', (req, res) => res.redirect('/display'));

function getLocalIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

app.get('/api/localip', (req, res) => res.json({ ip: getLocalIP(), port: PORT }));

app.get('/api/qr/:judgeId', async (req, res) => {
  const judge = STATE.judges.find(j => j.id === req.params.judgeId);
  if (!judge) return res.status(404).send('Not found');
  const url = `http://${getLocalIP()}:${PORT}/judge/${judge.id}`;
  const dataUrl = await QRCode.toDataURL(url, { width: 200, margin: 1, color: { dark: '#0f172a', light: '#ffffff' } });
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  res.set('Content-Type', 'image/png');
  res.send(Buffer.from(base64, 'base64'));
});

app.get('/api/state', (req, res) => {
  res.json({
    phase: STATE.phase,
    businessCases: STATE.businessCases,
    teams: STATE.teams,
    judges: STATE.judges,
    dimensions: STATE.dimensions,
    rankings: computeRankings(),
    phase2Rankings: computePhase2Rankings(),
    winners: STATE.winners,
    totalPhase2Votes: Object.keys(STATE.phase2votes).length
  });
});

app.get('/api/judge/:id', (req, res) => {
  const judge = STATE.judges.find(j => j.id === req.params.id);
  if (!judge) return res.status(404).json({ error: 'Judge not found' });
  const teams = judge.assignedTeams.map(tid => {
    const t = STATE.teams.find(t => t.id === tid);
    const bc = STATE.businessCases.find(b => b.id === t.caseId);
    return { ...t, caseName: bc.name, caseColor: bc.color };
  });
  const existingVotes = {};
  judge.assignedTeams.forEach(tid => {
    const key = `${judge.id}_${tid}`;
    if (STATE.votes[key]) existingVotes[tid] = STATE.votes[key];
  });
  res.json({ judge, teams, existingVotes, dimensions: STATE.dimensions, phase: STATE.phase });
});

app.post('/api/vote', (req, res) => {
  const { judgeId, teamId, scores } = req.body;
  const judge = STATE.judges.find(j => j.id === judgeId);
  if (!judge || !judge.assignedTeams.includes(teamId)) return res.status(400).json({ error: 'Invalid' });
  STATE.votes[`${judgeId}_${teamId}`] = scores;
  broadcast();
  res.json({ success: true });
});

app.post('/api/phase2vote', (req, res) => {
  const { voterId, teamId } = req.body;
  if (!STATE.winners.includes(teamId)) return res.status(400).json({ error: 'Invalid team' });
  STATE.phase2votes[voterId] = teamId;
  broadcast();
  res.json({ success: true });
});

app.post('/api/admin/winners', (req, res) => {
  STATE.winners = req.body.winners;
  broadcast();
  res.json({ success: true });
});

app.post('/api/admin/phase', (req, res) => {
  STATE.phase = req.body.phase;
  broadcast();
  res.json({ success: true });
});

app.post('/api/admin/reset', (req, res) => {
  STATE.votes = {};
  STATE.phase2votes = {};
  STATE.winners = [];
  STATE.phase = 1;
  broadcast();
  res.json({ success: true });
});

io.on('connection', socket => {
  socket.emit('update', {
    phase: STATE.phase,
    rankings: computeRankings(),
    phase2Rankings: computePhase2Rankings(),
    winners: STATE.winners,
    totalPhase2Votes: Object.keys(STATE.phase2votes).length
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🗳️  Workshop Voting running!\n`);
  console.log(`Display:  http://localhost:${PORT}/display`);
  console.log(`Admin:    http://localhost:${PORT}/admin`);
  console.log(`\nJudge links:`);
  STATE.judges.forEach(j => console.log(`  ${j.name}: http://localhost:${PORT}/judge/${j.id}`));
  console.log(`\nPhase 2 vote: http://localhost:${PORT}/vote?id=VOTER_ID`);
});
