import { useState, useCallback, useRef } from 'react';

const GH_API = 'https://api.github.com';

function timeAgo(d) {
  const s = (Date.now() - new Date(d)) / 1000;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 2592000) return `${Math.floor(s / 86400)}d ago`;
  return `${Math.floor(s / 2592000)}mo ago`;
}

function daysSince(d) {
  return (Date.now() - new Date(d)) / 86400000;
}

function Badge({ children, color }) {
  const colors = {
    green:  { bg: '#0f2d1a', text: '#3fb950', border: '#238636' },
    gray:   { bg: '#21262d', text: '#8b949e', border: '#30363d' },
    blue:   { bg: '#0c1d32', text: '#388bfd', border: '#1f4280' },
    orange: { bg: '#2d1b00', text: '#f0883e', border: '#7d4e00' },
    red:    { bg: '#2d0f0f', text: '#f85149', border: '#7d1a1a' },
  };
  const c = colors[color] || colors.gray;
  return (
    <span style={{
      background: c.bg, color: c.text, border: `1px solid ${c.border}`,
      borderRadius: 99, fontSize: 11, padding: '1px 8px', whiteSpace: 'nowrap', flexShrink: 0
    }}>{children}</span>
  );
}

function PRBadge({ issue }) {
  if (issue.active_prs > 0) return <Badge color="red">active PR</Badge>;
  if (issue.stale_prs > 0) return <Badge color="orange">stale PR ({issue.stale_prs})</Badge>;
  return <Badge color="blue">no PR</Badge>;
}

function IssueCard({ issue, selected, onClick }) {
  const free = issue.assignees.length === 0;
  const filteredLabels = issue.labels.filter(l => l.name !== 'good first issue').slice(0, 4);
  const borderLeft = free ? '#238636' : (issue.stale_prs > 0 ? '#f0883e' : '#484f58');
  return (
    <div onClick={onClick} style={{
      background: selected ? '#0c1d32' : '#161b22',
      border: `1px solid ${selected ? '#388bfd' : '#30363d'}`,
      borderLeft: `3px solid ${borderLeft}`,
      borderRadius: 8, padding: '12px 16px', cursor: 'pointer',
      opacity: free ? 1 : 0.7, transition: 'all 0.15s',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: '#e6edf3', lineHeight: 1.4 }}>
          <span style={{ color: '#8b949e' }}>#{issue.number}</span> {issue.title}
        </span>
        <Badge color={free ? 'green' : 'gray'}>{free ? 'open' : 'assigned'}</Badge>
      </div>
      <div style={{ display: 'flex', gap: 10, fontSize: 11, color: '#8b949e', flexWrap: 'wrap', alignItems: 'center' }}>
        <span>updated {timeAgo(issue.updated_at)}</span>
        <span>{issue.comments} comments</span>
        <span>{Math.floor(daysSince(issue.created_at))}d old</span>
        {!free && <span>→ {issue.assignees[0]?.login}</span>}
        <PRBadge issue={issue} />
        {issue.maintainer_commented && <Badge color="green">maintainer ✓</Badge>}
      </div>
      {filteredLabels.length > 0 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
          {filteredLabels.map(l => (
            <span key={l.name} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 99, border: '1px solid #30363d', color: '#8b949e' }}>{l.name}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, color }) {
  return (
    <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: '12px 16px' }}>
      <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600, color: color || '#e6edf3' }}>{value}</div>
    </div>
  );
}

export default function App() {
  const [repo, setRepo] = useState('meshery/meshery');
  const [label, setLabel] = useState('good first issue');
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);

  // Filters
  const [filterAssign, setFilterAssign] = useState('free');
  const [filterPR, setFilterPR] = useState('nopr');
  const [sortBy, setSortBy] = useState('updated');
  const [maxComments, setMaxComments] = useState('');
  const [maxAgeDays, setMaxAgeDays] = useState('');
  const [staleDays, setStaleDays] = useState(21);
  const [componentFilter, setComponentFilter] = useState('');
  const [excludeLabels, setExcludeLabels] = useState('issue/willfix, issue/design required');
  const [needsMaintainer, setNeedsMaintainer] = useState(false);

  const knownMaintainers = useRef(new Set());

  const GH_TOKEN = process.env.REACT_APP_GH_TOKEN;

async function ghFetch(url) {
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${GH_TOKEN}`,
      'Accept': 'application/vnd.github+json',
    }
  });
  if (!res.ok) {
    const rem = res.headers.get('x-ratelimit-remaining');
    if (rem === '0') throw new Error('GitHub rate limit hit. Wait ~1 hour.');
    throw new Error('GitHub API error: ' + res.status);
  }
  return res.json();
}

  async function checkPRsForIssue(issue) {
    try {
      const timeline = await ghFetch(`${GH_API}/repos/${repo}/issues/${issue.number}/timeline?per_page=100`);
      const prNums = [];
      for (const ev of timeline) {
        if (ev.event === 'cross-referenced' && ev.source?.issue?.pull_request) {
          prNums.push(ev.source.issue.number);
        }
      }
      if (prNums.length === 0) {
        const comments = await ghFetch(`${GH_API}/repos/${repo}/issues/${issue.number}/comments?per_page=50`);
        const maintainerCommented = comments.some(c =>
          knownMaintainers.current.has(c.user.login) ||
          ['MEMBER', 'OWNER', 'COLLABORATOR'].includes(c.author_association)
        );
        return { linked_prs: 0, active_prs: 0, stale_prs: 0, maintainer_commented: maintainerCommented };
      }

      let active = 0, stale = 0;
      for (const num of prNums.slice(0, 5)) {
        try {
          const pr = await ghFetch(`${GH_API}/repos/${repo}/pulls/${num}`);
          if (pr.state === 'open') {
            if (daysSince(pr.updated_at) <= staleDays) active++;
            else stale++;
          }
        } catch (e) {}
      }

      const comments = await ghFetch(`${GH_API}/repos/${repo}/issues/${issue.number}/comments?per_page=50`);
      const maintainerCommented = comments.some(c =>
        knownMaintainers.current.has(c.user.login) ||
        ['MEMBER', 'OWNER', 'COLLABORATOR'].includes(c.author_association)
      );

      return { linked_prs: prNums.length, active_prs: active, stale_prs: stale, maintainer_commented: maintainerCommented };
    } catch (e) {
      return { linked_prs: 0, active_prs: 0, stale_prs: 0, maintainer_commented: false };
    }
  }

  const fetchIssues = useCallback(async () => {
    if (!repo.includes('/')) { setError('Format: owner/repo'); return; }
    setError(''); setLoading(true); setIssues([]); setSelected(null);
    knownMaintainers.current = new Set();

    try {
      setLoadingMsg('Fetching issues...');
      let all = [];
      const enc = encodeURIComponent(label || 'good first issue');
      for (let p = 1; p <= 4; p++) {
        const data = await ghFetch(`${GH_API}/repos/${repo}/issues?state=open&labels=${enc}&per_page=50&page=${p}`);
        all = all.concat(data.filter(i => !i.pull_request));
        if (data.length < 50) break;
      }

      try {
        const collab = await ghFetch(`${GH_API}/repos/${repo}/collaborators?per_page=100`);
        collab.forEach(u => knownMaintainers.current.add(u.login));
      } catch (e) {}

      for (let i = 0; i < all.length; i++) {
        setLoadingMsg(`Checking PRs & comments: ${i + 1}/${all.length}...`);
        const info = await checkPRsForIssue(all[i]);
        all[i] = { ...all[i], ...info };
      }

      setIssues(all);
    } catch (e) {
      setError(e.message || 'Network error.');
    }

    setLoadingMsg('');
    setLoading(false);
  }, [repo, label, staleDays]);

  const excludeList = excludeLabels.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

  let displayed = [...issues];
  if (filterAssign === 'free') displayed = displayed.filter(i => i.assignees.length === 0);
  if (filterAssign === 'taken') displayed = displayed.filter(i => i.assignees.length > 0);
  if (filterPR === 'nopr') displayed = displayed.filter(i => i.active_prs === 0 && i.stale_prs === 0);
  if (filterPR === 'haspr') displayed = displayed.filter(i => i.active_prs > 0);
  if (filterPR === 'stale_only') displayed = displayed.filter(i => i.active_prs === 0 && i.stale_prs > 0);
  if (maxComments !== '') displayed = displayed.filter(i => i.comments <= parseInt(maxComments));
  if (maxAgeDays !== '') displayed = displayed.filter(i => daysSince(i.created_at) <= parseInt(maxAgeDays));
  if (componentFilter.trim()) displayed = displayed.filter(i => i.labels.some(l => l.name.toLowerCase().startsWith(componentFilter.trim().toLowerCase())));
  if (excludeList.length) displayed = displayed.filter(i => !i.labels.some(l => excludeList.includes(l.name.toLowerCase())));
  if (needsMaintainer) displayed = displayed.filter(i => i.maintainer_commented);
  if (sortBy === 'updated') displayed.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  if (sortBy === 'comments') displayed.sort((a, b) => b.comments - a.comments);
  if (sortBy === 'created') displayed.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  if (sortBy === 'age') displayed.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  const free = issues.filter(i => i.assignees.length === 0).length;
  const noActivePR = issues.filter(i => i.active_prs === 0).length;
  const stalePR = issues.filter(i => i.stale_prs > 0 && i.active_prs === 0).length;
  const goldmine = issues.filter(i => i.assignees.length === 0 && i.active_prs === 0 && i.stale_prs === 0).length;

  const inputStyle = { background: '#161b22', border: '1px solid #30363d', color: '#e6edf3', borderRadius: 6, padding: '7px 10px', fontSize: 13, outline: 'none' };
  const selectStyle = { ...inputStyle, cursor: 'pointer' };

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', background: '#0d1117', minHeight: '100vh', color: '#e6edf3' }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 4 }}>🎯 OSS Hunter <span style={{ fontSize: 12, background: '#0c1d32', color: '#388bfd', border: '1px solid #1f4280', borderRadius: 4, padding: '1px 7px', marginLeft: 6 }}>v2</span></h1>
        <p style={{ fontSize: 13, color: '#8b949e' }}>Find unassigned issues with no active PRs — with stale PR detection</p>
      </div>

      {/* Repo + label inputs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <input style={{ ...inputStyle, flex: 2, minWidth: 180 }} placeholder="owner/repo" value={repo}
          onChange={e => setRepo(e.target.value)} onKeyDown={e => e.key === 'Enter' && fetchIssues()} />
        <input style={{ ...inputStyle, flex: 1, minWidth: 160 }} placeholder="label" value={label}
          onChange={e => setLabel(e.target.value)} onKeyDown={e => e.key === 'Enter' && fetchIssues()} />
        <button onClick={fetchIssues} disabled={loading} style={{ background: loading ? '#21262d' : '#238636', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontSize: 14, fontWeight: 500, cursor: loading ? 'not-allowed' : 'pointer' }}>
          {loading ? 'Fetching...' : 'Fetch issues'}
        </button>
      </div>

      {error && <div style={{ color: '#f85149', fontSize: 13, marginBottom: 12 }}>{error}</div>}
      {loadingMsg && <div style={{ color: '#8b949e', fontSize: 12, marginBottom: 8 }}>{loadingMsg}</div>}

      {/* Filter panel */}
      <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: '12px 14px', marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '.5px' }}>Filters</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 4 }}>Assignment</div>
            <select style={{ ...selectStyle, width: '100%' }} value={filterAssign} onChange={e => setFilterAssign(e.target.value)}>
              <option value="free">Unassigned only</option>
              <option value="all">All</option>
              <option value="taken">Assigned only</option>
            </select>
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 4 }}>PR status</div>
            <select style={{ ...selectStyle, width: '100%' }} value={filterPR} onChange={e => setFilterPR(e.target.value)}>
              <option value="nopr">No active PR</option>
              <option value="stale_only">Stale PRs only</option>
              <option value="all">Any</option>
              <option value="haspr">Has active PR</option>
            </select>
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 4 }}>Sort by</div>
            <select style={{ ...selectStyle, width: '100%' }} value={sortBy} onChange={e => setSortBy(e.target.value)}>
              <option value="updated">Recently updated</option>
              <option value="created">Newest first</option>
              <option value="comments">Most discussed</option>
              <option value="age">Oldest first</option>
            </select>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 4 }}>Max comments</div>
            <input style={{ ...inputStyle, width: '100%' }} type="number" min="0" placeholder="e.g. 10 (blank = any)"
              value={maxComments} onChange={e => setMaxComments(e.target.value)} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 4 }}>Opened within (days)</div>
            <input style={{ ...inputStyle, width: '100%' }} type="number" min="0" placeholder="e.g. 180 (blank = any)"
              value={maxAgeDays} onChange={e => setMaxAgeDays(e.target.value)} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 4 }}>Stale PR threshold (days)</div>
            <input style={{ ...inputStyle, width: '100%' }} type="number" min="1"
              value={staleDays} onChange={e => setStaleDays(parseInt(e.target.value) || 21)} />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 4 }}>Component filter (e.g. component/ui)</div>
            <input style={{ ...inputStyle, width: '100%' }} placeholder="label prefix to require"
              value={componentFilter} onChange={e => setComponentFilter(e.target.value)} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 4 }}>Exclude labels (comma-separated)</div>
            <input style={{ ...inputStyle, width: '100%' }} placeholder="issue/willfix, issue/design required"
              value={excludeLabels} onChange={e => setExcludeLabels(e.target.value)} />
          </div>
        </div>
        <label style={{ fontSize: 12, color: '#8b949e', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={needsMaintainer} onChange={e => setNeedsMaintainer(e.target.checked)} />
          Require maintainer comment
        </label>
      </div>

      {/* Stats */}
      {issues.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, marginBottom: 16 }}>
          <StatCard label="Total" value={issues.length} />
          <StatCard label="Unassigned" value={free} color="#3fb950" />
          <StatCard label="No active PR" value={noActivePR} color="#388bfd" />
          <StatCard label="Stale PRs" value={stalePR} color="#f0883e" />
          <StatCard label="🎯 Goldmine" value={goldmine} color="#f0883e" />
        </div>
      )}

      {/* Issue list + detail */}
      <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 1fr' : '1fr', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: '70vh', overflowY: 'auto', paddingRight: 4 }}>
          {loading && <div style={{ color: '#8b949e', textAlign: 'center', padding: 40 }}>Fetching issues...</div>}
          {!loading && issues.length === 0 && !error && <div style={{ color: '#8b949e', textAlign: 'center', padding: 40 }}>Enter a repo and click fetch</div>}
          {!loading && issues.length > 0 && displayed.length === 0 && <div style={{ color: '#8b949e', textAlign: 'center', padding: 30, fontSize: 13 }}>No issues match current filters</div>}
          {issues.length > 0 && <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 2 }}>{displayed.length} shown</div>}
          {displayed.map(issue => (
            <IssueCard key={issue.id} issue={issue} selected={selected?.id === issue.id}
              onClick={() => setSelected(selected?.id === issue.id ? null : issue)} />
          ))}
        </div>

        {selected && (
          <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: 16, maxHeight: '70vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 4 }}>#{selected.number} · opened {timeAgo(selected.created_at)} · {Math.floor(daysSince(selected.created_at))}d old</div>
                <div style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.5 }}>{selected.title}</div>
              </div>
              <a href={selected.html_url} target="_blank" rel="noreferrer"
                style={{ fontSize: 12, color: '#388bfd', textDecoration: 'none', whiteSpace: 'nowrap', marginLeft: 8 }}>Open ↗</a>
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
              <Badge color={selected.assignees.length === 0 ? 'green' : 'gray'}>
                {selected.assignees.length === 0 ? 'unassigned' : `→ ${selected.assignees[0]?.login}`}
              </Badge>
              <PRBadge issue={selected} />
              {selected.maintainer_commented
                ? <Badge color="green">maintainer commented</Badge>
                : <Badge color="gray">no maintainer comment</Badge>}
            </div>
            <div style={{ fontSize: 11, color: '#8b949e' }}>
              linked PRs: {selected.linked_prs} total · {selected.active_prs} active · {selected.stale_prs} stale · {selected.comments} comments
            </div>
            <div style={{ height: 1, background: '#30363d', margin: '12px 0' }} />
            <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 6 }}>Description</div>
            <div style={{ fontSize: 13, color: '#c9d1d9', lineHeight: 1.7, whiteSpace: 'pre-wrap', marginBottom: 16 }}>
              {selected.body ? selected.body.slice(0, 1000) + (selected.body.length > 1000 ? '...' : '') : 'No description.'}
            </div>
            {selected.labels.length > 0 && (
              <>
                <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 6 }}>Labels</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 16 }}>
                  {selected.labels.map(l => <span key={l.name} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 99, border: '1px solid #30363d', color: '#8b949e' }}>{l.name}</span>)}
                </div>
              </>
            )}
            <a href={selected.html_url} target="_blank" rel="noreferrer"
              style={{ display: 'inline-block', background: '#238636', color: '#fff', borderRadius: 6, padding: '8px 16px', fontSize: 13, textDecoration: 'none', fontWeight: 500 }}>
              Open on GitHub ↗
            </a>
          </div>
        )}
      </div>
    </div>
  );
}