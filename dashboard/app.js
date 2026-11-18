// Token Launch Radar dashboard logic. All figures come from data.js,
// written by the program from the sealed snapshot. The farm steps below
// are generated from the same templates the board was built with, so the
// page and board.json always agree.
(function () {
  'use strict';
  var D = window.RADAR;
  var META = D.meta;
  var ROWS = D.rows.map(function (r) {
    return {
      slug: r[0], name: r[1], category: r[2], tvl: r[3], value: r[4],
      lo: r[5], hi: r[6], age: r[7], change: r[8], nChains: r[9],
      chain: r[10], watch: r[11] === 1, rankLo: r[12], rankHi: r[13],
      top20: r[14], cost: r[15], slice: r[16], odds: r[17], rank: r[18],
    };
  });
  var BY_SLUG = {};
  ROWS.forEach(function (row) { BY_SLUG[row.slug] = row; });

  function money(v) {
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return '$' + Math.round(v / 1e3) + 'K';
    return '$' + Math.round(v);
  }
  function ageText(age) {
    if (age === null || age === undefined) return 'n/a';
    if (age < 365) return Math.round(age) + 'd';
    return (age / 365).toFixed(1) + 'y';
  }
  function growthText(g) {
    if (g === null || g === undefined) return 'n/a';
    return (g >= 0 ? '+' : '') + g.toFixed(1) + '%';
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ---- Farm plans: same templates as the program's model. ----
  function groupOf(category) {
    if (category === null) return 'other';
    if (['Lending', 'CDP', 'CDP Manager', 'Uncollateralized Lending', 'Collateral Markets', 'Interest Rate Derivatives'].indexOf(category) >= 0) return 'lend';
    if (['Dexs', 'Derivatives', 'Options Vault', 'Prediction Market', 'OTC Marketplace'].indexOf(category) >= 0) return 'dex';
    if (['Yield', 'Yield Aggregator', 'Leveraged Farming', 'Basis Trading', 'Liquidity Manager', 'Farm', 'Dual-Token Stablecoin'].indexOf(category) >= 0) return 'yield';
    if (['Staking Pool', 'Restaking', 'Risk Curators', 'Anchor BTC', 'Decentralized BTC', 'Governance Incentives'].indexOf(category) >= 0) return 'stake';
    if (['RWA', 'Onchain Capital Allocator', 'Stablecoin Wrapper', 'Indexes'].indexOf(category) >= 0) return 'rwa';
    if (['Chain', 'Payments', 'Privacy', 'Insurance', 'Crypto Card Issuer', 'CeDeFi'].indexOf(category) >= 0) return 'chain';
    return 'other';
  }
  function depositFor(tvl) {
    if (tvl < 100000000) return 250;
    if (tvl < 500000000) return 500;
    return 1000;
  }
  function holdDays(age) {
    if (age === null || age === undefined) return 60;
    if (age < 180) return 90;
    if (age < 730) return 60;
    return 30;
  }
  var STEP_BUILDERS = {
    lend: [
      function (n, c) { return 'Bridge $' + c.deposit + ' in stablecoins to ' + c.chain + " through the protocol's own bridge page; keep $" + c.cost + ' aside for gas across ' + c.nChains + ' chain' + (c.nChains > 1 ? 's' : '') + ". Verify the deposit address on the protocol's site before sending anything."; },
      function (n, c) { return 'Supply the $' + c.deposit + ' to the ' + n + ' lending market on ' + c.chain + "; switch on the market's points or rewards toggle when the app shows one, and save the transaction hash with the date."; },
      function (n, c) { return 'Borrow only up to 40% of the supplied collateral, and only while the borrow rate stays below the supply reward; otherwise leave the position supplied and idle for ' + c.hold + ' days.'; },
      function (n, c) { return 'Return weekly: re-check the supply rate, the points balance and any quest or epoch page, and top the position up only after two straight weeks of TVL growth.'; },
      function (n, c) { return 'Before any token announcement, withdraw a small test amount to confirm the exit path works, then hold the position until a claim window opens; never deposit money you cannot leave untouched for ' + c.hold + ' days.'; },
    ],
    dex: [
      function (n, c) { return 'Bridge $' + c.deposit + " in stablecoins plus the chain's gas token to " + c.chain + '; budget $' + c.cost + ' for gas across ' + c.nChains + ' chain' + (c.nChains > 1 ? 's' : '') + " and confirm the pool address on the protocol's own site first."; },
      function (n, c) { return 'Add the $' + c.deposit + ' as liquidity to the deepest ' + n + ' pool on ' + c.chain + ', in the pair with the most volume; keep the LP receipt and note the entry price.'; },
      function (n, c) { return 'Route one real swap a week through ' + n + ' on ' + c.chain + ' instead of another venue, keeping each swap under 1% of the pool so the route stays cheap; log the volume you add.'; },
      function (n, c) { return 'Return weekly: check fee earnings against impermanent loss, the points or volume leaderboard, and any new pool incentives; move the position only when fees beat the loss for two weeks running.'; },
      function (n, c) { return 'Test a small withdrawal before any token announcement to confirm the exit path, then hold the LP position for ' + c.hold + ' days; never deposit money you cannot leave untouched that long.'; },
    ],
    yield: [
      function (n, c) { return 'Bridge $' + c.deposit + ' to ' + c.chain + " through the protocol's own bridge page; keep $" + c.cost + ' aside for gas across ' + c.nChains + ' chain' + (c.nChains > 1 ? 's' : '') + " and double-check the vault address on the protocol's site."; },
      function (n, c) { return 'Deposit the $' + c.deposit + ' into the ' + n + ' vault on ' + c.chain + ' with the longest track record; enable points or rewards tracking when the app offers it and save the transaction hash.'; },
      function (n, c) { return 'Leave the deposit compounding for ' + c.hold + ' days without chasing the newest vault; a vault switch costs gas twice and resets most points multipliers.'; },
      function (n, c) { return "Return weekly: compare the vault's realised yield with its advertised rate, check the points balance and any epoch page, and only add funds after two straight weeks of TVL growth."; },
      function (n, c) { return 'Withdraw a small test amount before any token announcement to confirm the exit path works, then hold until a claim window opens; never deposit money you cannot leave untouched for ' + c.hold + ' days.'; },
    ],
    stake: [
      function (n, c) { return 'Bridge $' + c.deposit + ' in the stakeable asset to ' + c.chain + '; budget $' + c.cost + ' for gas across ' + c.nChains + ' chain' + (c.nChains > 1 ? 's' : '') + " and verify the staking contract on the protocol's own site before approving anything."; },
      function (n, c) { return 'Stake the $' + c.deposit + ' with ' + n + ' on ' + c.chain + " through the protocol's own app, choosing the validator or curator with the longest uptime record; save the transaction hash and the unlock date."; },
      function (n, c) { return 'Keep the stake locked for the full ' + c.hold + '-day horizon; early exits usually pay a penalty and forfeit the points multiplier the farm is actually for.'; },
      function (n, c) { return 'Return weekly: confirm the stake still earns, check the points or restaking balance and any governance or quest page, and only add stake after two straight weeks of TVL growth.'; },
      function (n, c) { return 'Test the unstake path with a small amount before any token announcement so the exit is proven, then hold until a claim window opens; never stake money you cannot leave untouched for ' + c.hold + ' days.'; },
    ],
    rwa: [
      function (n, c) { return 'Bridge $' + c.deposit + ' in stablecoins to ' + c.chain + '; budget $' + c.cost + ' for gas across ' + c.nChains + ' chain' + (c.nChains > 1 ? 's' : '') + " and confirm the vault or token address on the protocol's own site first."; },
      function (n, c) { return 'Allocate the $' + c.deposit + ' to the ' + n + ' product on ' + c.chain + ' with the longest redemption history; read the redemption terms and lock-up before confirming, and save the receipt.'; },
      function (n, c) { return 'Hold the allocation for ' + c.hold + ' days; real-world products redeem slowly, so plan the exit around the stated redemption window rather than the market' + "'" + 's mood.'; },
      function (n, c) { return 'Return weekly: check the net asset value update, the points or allocation record and any compliance or quest page; add funds only after two straight weeks of TVL growth.'; },
      function (n, c) { return 'Request a small test redemption before any token announcement to confirm the exit path and timing, then hold until a claim window opens; never allocate money you cannot leave untouched for ' + c.hold + ' days.'; },
    ],
    chain: [
      function (n, c) { return 'Bridge $' + c.deposit + ' to ' + c.chain + " through the protocol's own bridge page; keep $" + c.cost + ' aside for gas across ' + c.nChains + ' chain' + (c.nChains > 1 ? 's' : '') + " and verify the chain id on the protocol's site before sending."; },
      function (n, c) { return 'Use the $' + c.deposit + ' in the ' + n + ' app on ' + c.chain + ' for its core action — transact, pay or post — at least twice in the first week, and save both transaction hashes.'; },
      function (n, c) { return 'Keep a regular cadence for ' + c.hold + ' days: one genuine transaction a week beats ten rushed ones, and most points systems reward streaks over bursts.'; },
      function (n, c) { return 'Return weekly: check the points or activity record, the quest or epoch page and whether the app added a feature worth using; add funds only after two straight weeks of TVL growth.'; },
      function (n, c) { return 'Move a small amount back out before any token announcement to confirm the exit path works, then hold the position until a claim window opens; never deposit money you cannot leave untouched for ' + c.hold + ' days.'; },
    ],
    other: [
      function (n, c) { return 'Bridge $' + c.deposit + ' to ' + c.chain + " through the protocol's own pages; budget $" + c.cost + ' for gas across ' + c.nChains + ' chain' + (c.nChains > 1 ? 's' : '') + " and verify every contract address on the protocol's site before approving."; },
      function (n, c) { return 'Put the $' + c.deposit + ' to work in the ' + n + ' app' + "'" + 's main feature on ' + c.chain + '; switch on points or rewards tracking when offered and save the transaction hash with the date.'; },
      function (n, c) { return 'Stay active for ' + c.hold + ' days at a steady weekly cadence; points systems usually reward streaks and tenure, not one large deposit.'; },
      function (n, c) { return 'Return weekly: check the points balance, the quest or epoch page and the protocol' + "'" + 's own announcements; add funds only after two straight weeks of TVL growth.'; },
      function (n, c) { return 'Test a small withdrawal before any token announcement to confirm the exit path works, then hold until a claim window opens; never deposit money you cannot leave untouched for ' + c.hold + ' days.'; },
    ],
  };
  function farmStepsFor(row) {
    var ctx = {
      chain: row.chain === null ? 'its home chain' : row.chain,
      nChains: row.nChains,
      deposit: depositFor(row.tvl),
      cost: row.cost,
      hold: holdDays(row.age),
    };
    return STEP_BUILDERS[groupOf(row.category)].map(function (build) { return build(row.name, ctx); });
  }
  // Exposed for the self-check harness: the page's steps must equal the board's.
  window.RADAR_FARM_STEPS = farmStepsFor;

  // ---- Self-check: recompute the board's integrity in the browser. ----
  function verifyBoardIntegrity() {
    var checks = [];
    var ok = true;
    function check(name, pass) {
      checks.push({ label: name, pass: pass });
      if (!pass) ok = false;
    }
    check('rows ' + ROWS.length + '/' + META.audit.boardRows, ROWS.length === META.audit.boardRows);
    var ranks = ROWS.map(function (r) { return r.rank; }).sort(function (a, b) { return a - b; });
    check('ranks 1-' + ROWS.length, ranks.every(function (rk, i) { return rk === i + 1; }));
    var byRank = ROWS.slice().sort(function (a, b) { return a.rank - b.rank; });
    var sorted = byRank.every(function (r, i) { return i === 0 || byRank[i - 1].value >= r.value; });
    check('values do not rise with rank', sorted);
    var seen = {};
    var dup = ROWS.some(function (r) { if (seen[r.slug]) return true; seen[r.slug] = 1; return false; });
    check('slugs unique', !dup);
    var watchCount = ROWS.filter(function (r) { return r.watch; }).length;
    check('watchlist ' + watchCount + '/' + META.audit.watchlist, watchCount === META.audit.watchlistOnBoard);
    var total = ROWS.reduce(function (s, r) { return s + r.value; }, 0);
    return { ok: ok, checks: checks, total: total };
  }

  // ---- What-if pricing: slice, net and break-even from stated inputs. ----
  function recomputeFarmEconomics(row) {
    var deposit = parseFloat(document.getElementById('wiDeposit').value) || 0;
    var sharePct = parseFloat(document.getElementById('wiShare').value) || 0;
    var slice = (sharePct / 100) * row.value;
    var net = slice - row.cost;
    var beShare = (row.cost / row.value) * 100;
    var roi = deposit > 0 ? (net / deposit) * 100 : 0;
    var beText = beShare >= 0.01 ? beShare.toFixed(3) : beShare.toPrecision(2);
    var out = document.getElementById('wiOut');
    out.innerHTML =
      'Slice of implied value: <b>' + money(slice) + '</b> &nbsp;·&nbsp; ' +
      'Farm cost: <b>$' + row.cost + '</b> &nbsp;·&nbsp; ' +
      'Net: <b>' + (net < 0 ? '−' : '') + money(Math.abs(net)) + '</b> &nbsp;·&nbsp; ' +
      'Return on deposit: <b>' + roi.toFixed(1) + '%</b> &nbsp;·&nbsp; ' +
      'Break-even slice: <b>' + beText + '%</b> of implied value.';
    return { slice: slice, net: net, beShare: beShare, roi: roi };
  }

  // ---- Board rendering, sorting and filtering. ----
  var sortKey = 'rank';
  var currentDetail = null;

  function filteredRows() {
    var q = document.getElementById('q').value.trim().toLowerCase();
    var cat = document.getElementById('catFilter').value;
    var watchOnly = document.getElementById('watchOnly').checked;
    var list = ROWS.filter(function (r) {
      if (watchOnly && !r.watch) return false;
      if (cat && r.category !== cat) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var cmp = {
      rank: function (a, b) { return a.rank - b.rank; },
      value: function (a, b) { return b.value - a.value; },
      tvl: function (a, b) { return b.tvl - a.tvl; },
      age: function (a, b) { return (b.age === null ? -1 : b.age) - (a.age === null ? -1 : a.age); },
      growth: function (a, b) { return (b.change === null ? -Infinity : b.change) - (a.change === null ? -Infinity : a.change); },
      name: function (a, b) { return a.name.localeCompare(b.name); },
    }[sortKey] || function (a, b) { return a.rank - b.rank; };
    return list.sort(cmp);
  }

  function renderBoard() {
    var list = filteredRows();
    var html = list.map(function (r) {
      var net = r.slice - r.cost;
      var be = r.odds >= 1 ? '1 in ' + Math.round(r.odds) : 'below cost';
      return '<tr data-slug="' + esc(r.slug) + '" class="' + (r.watch ? 'watch' : '') + '">' +
        '<td>' + r.rank + '</td>' +
        '<td><span class="name">' + esc(r.name) + '</span> <span class="slug">' + esc(r.slug) + '</span>' + (r.watch ? '<span class="badge">WATCHLIST</span>' : '') + '</td>' +
        '<td>' + esc(r.category === null ? '—' : r.category) + '</td>' +
        '<td>' + money(r.tvl) + '</td>' +
        '<td><b>' + money(r.value) + '</b></td>' +
        '<td>' + money(r.lo) + ' – ' + money(r.hi) + '</td>' +
        '<td>' + ageText(r.age) + '</td>' +
        '<td>' + growthText(r.change) + '</td>' +
        '<td>' + r.rankLo + '–' + r.rankHi + '</td>' +
        '<td>' + (net < 0 ? '−' : '') + money(Math.abs(net)) + '</td>' +
        '<td>' + be + '</td></tr>';
    }).join('');
    document.getElementById('boardBody').innerHTML = html;
    document.getElementById('rowCount').textContent = 'Showing ' + list.length + ' of ' + ROWS.length;
  }

  function openDetail(slug, scroll) {
    var row = BY_SLUG[slug];
    if (!row) return;
    currentDetail = row;
    document.getElementById('detailName').textContent = row.name + '  ·  rank ' + row.rank;
    var stats = [
      ['Implied value', money(row.value), 'range ' + money(row.lo) + ' – ' + money(row.hi)],
      ['TVL', money(row.tvl), row.nChains + ' chain' + (row.nChains > 1 ? 's' : '') + ', home ' + (row.chain === null ? 'n/a' : row.chain)],
      ['Age / 7-day change', ageText(row.age) + ' / ' + growthText(row.change), 'listed ' + (row.age === null ? 'date unreported' : Math.round(row.age) + ' days before the snapshot')],
      ['Bootstrap rank range', row.rankLo + '–' + row.rankHi, 'top-20 in ' + Math.round(row.top20 * 100) + '% of 200 refits'],
      ['Farm cost estimate', '$' + row.cost, 'gas and fees across ' + row.nChains + ' chain' + (row.nChains > 1 ? 's' : '')],
      ['Break-even', row.odds >= 1 ? '1 in ' + Math.round(row.odds) : 'below cost', 'assumed 0.05% slice of ' + money(row.value)],
      ['Category', row.category === null ? 'none recorded' : row.category, row.watch ? 'on the snapshot watchlist' : 'not on the snapshot watchlist'],
      ['Record', 'records no token', 'the snapshot carries no token record for this protocol'],
    ];
    document.getElementById('detailStats').innerHTML = stats.map(function (s) {
      return '<div class="stat"><div class="k">' + s[0] + '</div><div class="v">' + esc(s[1]) + '</div><div class="s">' + esc(s[2]) + '</div></div>';
    }).join('');
    document.getElementById('detailSteps').innerHTML = farmStepsFor(row).map(function (s) {
      return '<li>' + esc(s) + '</li>';
    }).join('');
    document.getElementById('detail').hidden = false;
    recomputeFarmEconomics(row);
    if (scroll) document.getElementById('detail').scrollIntoView({ behavior: 'auto', block: 'start' });
  }

  function closeDetail() {
    currentDetail = null;
    document.getElementById('detail').hidden = true;
    if (window.location.hash.length > 1) history.replaceState(null, '', window.location.pathname);
  }

  // ---- Tabs and deep links. ----
  function showTab(which) {
    var board = which === 'board';
    document.getElementById('boardView').hidden = !board;
    document.getElementById('methodView').hidden = board;
    document.getElementById('tabBoard').classList.toggle('active', board);
    document.getElementById('tabMethod').classList.toggle('active', !board);
  }
  function handleHash(scroll) {
    var h = window.location.hash.replace(/^#/, '');
    if (!h) return;
    if (h === 'method') { showTab('method'); return; }
    if (h === 'board') { showTab('board'); return; }
    if (BY_SLUG[h]) {
      showTab('board');
      openDetail(h, scroll);
    }
  }

  // ---- Method cards. ----
  function renderMethod() {
    var f = META.fit;
    var ab = META.ablation.map(function (r) {
      return '<tr><td>' + esc(r[0]) + '</td><td>×' + r[1] + ' / ' + r[2] + '% / ' + r[3] + '%</td><td>×' + r[4] + '</td><td>×' + r[5] + '</td></tr>';
    }).join('');
    var clockY = META.clock.byYear.map(function (b) {
      return '<tr><td>' + b[0] + '</td><td>' + b[1] + '</td><td>' + b[2] + '%</td></tr>';
    }).join('');
    var clockA = META.clock.byAge.map(function (b) {
      return '<tr><td>' + b[0] + '</td><td>' + b[1] + '</td><td>' + b[2] + '%</td></tr>';
    }).join('');
    var a = META.audit;
    document.getElementById('methodCards').innerHTML =
      '<section class="card"><h2>Value model</h2>' +
      '<p>log10(market cap) = ' + f.intercept + ' + ' + f.slope + ' · log10(TVL), fit on ' + f.n + ' traded comparables with market-cap/TVL in [0.01, 5], no CEX. R² ' + f.r2 + '.</p>' +
      '<p>Category effects are shrunk (K = 8, minimum 3 comparables). A bounded hand rule adds momentum (0.3 × 7-day change) and a youth-only seasoning discount (0.2 × shortfall below log-age 2.5), capped at ±0.075 in log10. No fitted growth, age or chain term is shipped: the ablation shows why.</p></section>' +
      '<section class="card"><h2>Holdout ablation</h2>' +
      '<table><thead><tr><th>Variant</th><th>Leave-one-out</th><th>Old third</th><th>New third</th></tr></thead><tbody>' + ab + '</tbody></table>' +
      '<p>Median miss, with within-3× / within-10× shares for leave-one-out. Fitted terms win nothing out of sample and collapse on the walk-forward split, so they are rejected.</p></section>' +
      '<section class="card"><h2>Range honesty</h2>' +
      '<p>Each row’s range is the leave-one-out residual band: the P25–P75 band covers ' + META.range.cover50 + ' of ' + META.range.n + ' comparables, the P10–P90 band ' + META.range.cover80 + ' of ' + META.range.n + '. Bands are residual quantiles, not confidence intervals.</p>' +
      '<p>Bootstrap: ' + META.bootstrap.refits + ' seeded refits; ' + META.bootstrap.stable + ' of the top 20 stay in the top 20 in at least half the refits. Rank ranges on each row are the 5th–95th percentiles of its bootstrap ranks.</p></section>' +
      '<section class="card"><h2>Clock bands (descriptive)</h2>' +
      '<table><thead><tr><th>Listed</th><th>n</th><th>With token</th></tr></thead><tbody>' + clockY + '</tbody></table>' +
      '<table><thead><tr><th>Age band</th><th>n</th><th>With token</th></tr></thead><tbody>' + clockA + '</tbody></table>' +
      '<p>Counts of the snapshot only. They describe who has a token by now, not who will get one.</p></section>' +
      '<section class="card"><h2>Audit</h2>' +
      '<p>' + a.total + ' protocols = ' + a.preToken + ' recording no token + ' + a.traded + ' traded. Traded with a market cap: ' + a.tradedWithMcap + '; without: ' + a.tradedWithoutMcap + '.</p>' +
      '<p>Screened off the board: ' + a.screenedCategory + ' by category, ' + a.screenedVersion + ' by version suffix, ' + a.screenedWord + ' by wrapped/staked wording, ' + a.screenedExchange + ' by exchange prefix. Board ' + a.boardRows + ' rows; watchlist ' + a.watchlistOnBoard + '/' + a.watchlist + ' covered; comparables ' + a.comps + '.</p></section>' +
      '<section class="card"><h2>Farm costs and break-even</h2>' +
      '<p>Farm cost is an estimate: $18 plus $4 per chain up to five, plus $10 when a protocol spans chains. Break-even odds are cost divided by the assumed slice (0.05% of implied value): the odds at which farming breaks even if the slice is right. Change the deposit and slice in any detail view to reprice.</p></section>';
  }

  // ---- Init. ----
  function init() {
    document.getElementById('metaLine').innerHTML =
      'Snapshot ' + esc(META.asOf) + '<br>Watchlist floor ' + money(META.floor);
    var a = META.audit;
    document.getElementById('auditBar').innerHTML =
      '<span><b>' + a.total + '</b> protocols</span>' +
      '<span><b>' + a.preToken + '</b> record no token</span>' +
      '<span><b>' + a.boardRows + '</b> on the board</span>' +
      '<span>watchlist <b>' + a.watchlistOnBoard + '/' + a.watchlist + '</b></span>' +
      '<span><b>' + a.comps + '</b> comparables</span>' +
      '<span>fit R² <b>' + META.fit.r2 + '</b></span>';
    var chk = verifyBoardIntegrity();
    var el = document.getElementById('selfCheck');
    var labels = chk.checks.map(function (c) { return (c.pass ? '' : 'FAILED ') + c.label; });
    el.textContent = 'Self-check ' + (chk.ok ? 'passed' : 'FAILED') + ': ' + labels.join(' · ') + ' · total implied value ' + money(chk.total);
    if (!chk.ok) el.classList.add('fail');

    var cats = [];
    ROWS.forEach(function (r) { if (r.category !== null && cats.indexOf(r.category) < 0) cats.push(r.category); });
    cats.sort();
    document.getElementById('catFilter').innerHTML = '<option value="">All categories</option>' +
      cats.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');

    renderBoard();
    renderMethod();

    document.getElementById('q').addEventListener('input', renderBoard);
    document.getElementById('catFilter').addEventListener('change', renderBoard);
    document.getElementById('watchOnly').addEventListener('change', renderBoard);
    document.getElementById('sortSel').addEventListener('change', function (e) {
      sortKey = e.target.value;
      renderBoard();
    });
    document.querySelectorAll('thead th[data-sort]').forEach(function (th) {
      th.addEventListener('click', function () {
        sortKey = th.getAttribute('data-sort');
        document.getElementById('sortSel').value = sortKey in { rank: 1, value: 1, tvl: 1, age: 1, growth: 1 } ? sortKey : 'rank';
        renderBoard();
      });
    });
    document.getElementById('boardBody').addEventListener('click', function (e) {
      var tr = e.target.closest('tr[data-slug]');
      if (!tr) return;
      var slug = tr.getAttribute('data-slug');
      history.replaceState(null, '', '#' + slug);
      openDetail(slug, true);
    });
    document.getElementById('detailClose').addEventListener('click', closeDetail);
    document.getElementById('wiGo').addEventListener('click', function () {
      if (currentDetail) recomputeFarmEconomics(currentDetail);
    });
    document.getElementById('wiDeposit').addEventListener('input', function () {
      if (currentDetail) recomputeFarmEconomics(currentDetail);
    });
    document.getElementById('wiShare').addEventListener('input', function () {
      if (currentDetail) recomputeFarmEconomics(currentDetail);
    });
    document.getElementById('tabBoard').addEventListener('click', function () {
      showTab('board');
      history.replaceState(null, '', '#board');
    });
    document.getElementById('tabMethod').addEventListener('click', function () {
      showTab('method');
      history.replaceState(null, '', '#method');
    });
    window.addEventListener('hashchange', function () { handleHash(true); });
    handleHash(false);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
