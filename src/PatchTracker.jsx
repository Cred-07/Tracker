import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Plus, Search, X, Trash2, ChevronDown, ChevronUp,
  Filter, Calendar, Shield, Server, CheckCircle2, Clock,
  FileText, User, Edit3, ArrowUpDown, Bandage
} from 'lucide-react'

/* ── helpers ───────────────────────────────────── */

const uid = (() => { let c = Date.now(); return () => `p_${c++}` })()

const STORAGE_KEY = 'patch_tracker_data'

const ENV_STYLES = {
  Production: { bg: 'bg-rose-500/15', text: 'text-rose-400', border: 'border-rose-500/30', dot: 'bg-rose-400' },
  'Pre-Prod':  { bg: 'bg-amber-500/15', text: 'text-amber-400', border: 'border-amber-500/30', dot: 'bg-amber-400' },
  SIT:         { bg: 'bg-emerald-500/15', text: 'text-emerald-400', border: 'border-emerald-500/30', dot: 'bg-emerald-400' },
  UAT:         { bg: 'bg-violet-500/15', text: 'text-violet-400', border: 'border-violet-500/30', dot: 'bg-violet-400' },
  Dev:         { bg: 'bg-sky-500/15', text: 'text-sky-400', border: 'border-sky-500/30', dot: 'bg-sky-400' },
}

const TEST_STYLES = {
  Passed:       { bg: 'bg-emerald-500/15', text: 'text-emerald-400', border: 'border-emerald-500/30' },
  'In Progress': { bg: 'bg-amber-500/15', text: 'text-amber-400', border: 'border-amber-500/30' },
  Failed:       { bg: 'bg-rose-500/15', text: 'text-rose-400', border: 'border-rose-500/30' },
  Pending:      { bg: 'bg-slate-500/15', text: 'text-slate-400', border: 'border-slate-500/30' },
}

const DEPLOY_STYLES = {
  Deployed:    { bg: 'bg-emerald-500/15', text: 'text-emerald-400', border: 'border-emerald-500/30' },
  'In Queue':  { bg: 'bg-amber-500/15', text: 'text-amber-400', border: 'border-amber-500/30' },
  Rolled_Back: { bg: 'bg-rose-500/15', text: 'text-rose-400', border: 'border-rose-500/30' },
  Scheduled:   { bg: 'bg-sky-500/15', text: 'text-sky-400', border: 'border-sky-500/30' },
}

const ENVIRONMENTS = Object.keys(ENV_STYLES)
const TEST_STATUSES = Object.keys(TEST_STYLES)
const DEPLOY_STATUSES = Object.keys(DEPLOY_STYLES)

function formatDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

function formatDateShort(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function todayStr() {
  return new Date().toISOString().split('T')[0]
}

/* ── seed data ─────────────────────────────────── */

const SEED_PATCHES = [
  {
    id: uid(), name: 'Status API patch',
    preparedDate: '2026-03-23', releaseDate: '2026-03-23',
    environment: 'Production', testingStatus: 'Passed', deploymentStatus: 'Deployed',
    responsiblePerson: 'Adarsh Pandey', filesChanged: 'RCA_GenBillAmt_Failure_on_RB',
  },
  {
    id: uid(), name: 'Pre-Prod patch release (KDAC signoff)',
    preparedDate: '2026-03-02', releaseDate: '2026-03-02',
    environment: 'Pre-Prod', testingStatus: 'In Progress', deploymentStatus: 'Deployed',
    responsiblePerson: 'Adarsh Pandey', filesChanged: '',
  },
  {
    id: uid(), name: 'KR200 / STP patch release',
    preparedDate: '2026-02-12', releaseDate: '2026-02-12',
    environment: 'SIT', testingStatus: 'Passed', deploymentStatus: 'Deployed',
    responsiblePerson: 'Adarsh Pandey', filesChanged: '',
  },
  {
    id: uid(), name: 'RBI optimization patch with STP',
    preparedDate: '2026-02-11', releaseDate: '2026-02-11',
    environment: 'SIT', testingStatus: 'Passed', deploymentStatus: 'Deployed',
    responsiblePerson: 'Adarsh Pandey', filesChanged: '',
  },
  {
    id: uid(), name: 'STP point patch #8',
    preparedDate: '2026-02-10', releaseDate: '2026-02-11',
    environment: 'SIT', testingStatus: 'Passed', deploymentStatus: 'Deployed',
    responsiblePerson: 'Adarsh Pandey', filesChanged: 'KB100084366101072 / LRS API d...',
  },
]

/* ── components ────────────────────────────────── */

function Badge({ label, styles }) {
  const s = styles || { bg: 'bg-slate-500/15', text: 'text-slate-400', border: 'border-slate-500/30' }
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border badge-hover ${s.bg} ${s.text} ${s.border}`}>
      {s.dot && <span className={`w-1.5 h-1.5 rounded-full ${s.dot} ${label === 'In Progress' || label === 'In Queue' ? 'dot-pulse' : ''}`} />}
      {label}
    </span>
  )
}

function StatCard({ icon: Icon, label, value, delay }) {
  return (
    <div className="stat-animate flex items-center gap-3 px-4 py-3 rounded-lg border border-[var(--pt-border)] bg-[var(--pt-surface)]"
         style={{ animationDelay: `${delay}ms` }}>
      <div className="p-2 rounded-md bg-[var(--pt-copper-glow)]">
        <Icon size={16} className="text-[var(--pt-copper)]" />
      </div>
      <div>
        <div className="font-mono text-lg font-medium text-[var(--pt-text)]">{value}</div>
        <div className="text-[10px] uppercase tracking-wider text-[var(--pt-text-muted)]">{label}</div>
      </div>
    </div>
  )
}

function SelectField({ label, value, onChange, options, className = '' }) {
  return (
    <div className={className}>
      <label className="block text-[10px] uppercase tracking-wider text-[var(--pt-text-muted)] mb-1.5">{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)}
              className="w-full bg-[var(--pt-bg)] border border-[var(--pt-border)] rounded-md px-3 py-2 text-sm text-[var(--pt-text)] input-copper focus:outline-none">
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  )
}

function InputField({ label, value, onChange, type = 'text', placeholder = '', className = '' }) {
  return (
    <div className={className}>
      <label className="block text-[10px] uppercase tracking-wider text-[var(--pt-text-muted)] mb-1.5">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
             className="w-full bg-[var(--pt-bg)] border border-[var(--pt-border)] rounded-md px-3 py-2 text-sm text-[var(--pt-text)] input-copper placeholder:text-[var(--pt-text-muted)]" />
    </div>
  )
}

/* ── create / edit modal ──────────────────────── */

function PatchModal({ patch, onSave, onClose }) {
  const isEdit = !!patch
  const [form, setForm] = useState(patch || {
    name: '', preparedDate: todayStr(), releaseDate: todayStr(),
    environment: 'SIT', testingStatus: 'Pending', deploymentStatus: 'In Queue',
    responsiblePerson: '', filesChanged: '',
  })

  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }))

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!form.name.trim()) return
    onSave({ ...form, id: form.id || uid() })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-animate"
         onClick={onClose}
         style={{ backgroundColor: 'rgba(4, 6, 14, 0.85)', backdropFilter: 'blur(8px)' }}>
      <form onSubmit={handleSubmit}
            onClick={e => e.stopPropagation()}
            className="modal-animate w-full max-w-lg bg-[var(--pt-surface)] border border-[var(--pt-border-bright)] rounded-xl p-6 shadow-2xl">

        <div className="flex items-center justify-between mb-6">
          <h2 className="font-fraunces text-xl text-[var(--pt-copper)]">
            {isEdit ? 'Edit Patch' : 'New Patch'}
          </h2>
          <button type="button" onClick={onClose}
                  className="p-1.5 rounded-md hover:bg-[var(--pt-border)] transition-colors">
            <X size={18} className="text-[var(--pt-text-muted)]" />
          </button>
        </div>

        <div className="space-y-4">
          <InputField label="Patch Name" value={form.name}
                      onChange={v => set('name', v)} placeholder="e.g. Status API patch" />

          <div className="grid grid-cols-2 gap-4">
            <InputField label="Prepared Date" type="date" value={form.preparedDate}
                        onChange={v => set('preparedDate', v)} />
            <InputField label="Release Date" type="date" value={form.releaseDate}
                        onChange={v => set('releaseDate', v)} />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <SelectField label="Environment" value={form.environment}
                         onChange={v => set('environment', v)} options={ENVIRONMENTS} />
            <SelectField label="Testing" value={form.testingStatus}
                         onChange={v => set('testingStatus', v)} options={TEST_STATUSES} />
            <SelectField label="Deployment" value={form.deploymentStatus}
                         onChange={v => set('deploymentStatus', v)} options={DEPLOY_STATUSES} />
          </div>

          <InputField label="Responsible Person" value={form.responsiblePerson}
                      onChange={v => set('responsiblePerson', v)} placeholder="e.g. John Doe" />

          <InputField label="Files Changed" value={form.filesChanged}
                      onChange={v => set('filesChanged', v)} placeholder="e.g. RCA_GenBillAmt_Failure..." />
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button type="button" onClick={onClose}
                  className="px-4 py-2 text-sm rounded-md border border-[var(--pt-border)] text-[var(--pt-text-muted)] hover:bg-[var(--pt-border)] transition-colors">
            Cancel
          </button>
          <button type="submit"
                  className="btn-copper px-5 py-2 text-sm font-medium rounded-md bg-[var(--pt-copper)] text-[#080c18] hover:bg-[var(--pt-gold)] transition-colors">
            {isEdit ? 'Save Changes' : 'Create Patch'}
          </button>
        </div>
      </form>
    </div>
  )
}

/* ── table view selector ──────────────────────── */

function ViewToggle({ view, setView }) {
  return (
    <div className="inline-flex rounded-lg border border-[var(--pt-border)] bg-[var(--pt-surface)] p-1">
      {['All Patches', 'Recent'].map(v => (
        <button key={v} onClick={() => setView(v)}
                className={`px-4 py-1.5 text-xs font-medium rounded-md transition-all duration-200 ${
                  view === v
                    ? 'bg-[var(--pt-copper)] text-[#080c18]'
                    : 'text-[var(--pt-text-muted)] hover:text-[var(--pt-text)]'
                }`}>
          {v}
        </button>
      ))}
    </div>
  )
}

/* ── sort button ──────────────────────────────── */

function SortButton({ column, sortBy, sortDir, onSort }) {
  const active = sortBy === column
  return (
    <button onClick={() => onSort(column)}
            className={`inline-flex items-center gap-1 transition-colors ${active ? 'text-[var(--pt-copper)]' : 'hover:text-[var(--pt-text)]'}`}>
      <ArrowUpDown size={12} className={active ? 'text-[var(--pt-copper)]' : 'text-[var(--pt-text-muted)]'} />
    </button>
  )
}

/* ── filter dropdown ──────────────────────────── */

function FilterDropdown({ filters, setFilters }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)}
              className={`flex items-center gap-2 px-3 py-2 text-xs rounded-md border transition-colors ${
                (filters.environment || filters.testingStatus || filters.deploymentStatus)
                  ? 'border-[var(--pt-copper)] text-[var(--pt-copper)] bg-[var(--pt-copper-glow)]'
                  : 'border-[var(--pt-border)] text-[var(--pt-text-muted)] hover:border-[var(--pt-border-bright)]'
              }`}>
        <Filter size={14} />
        Filters
        {(filters.environment || filters.testingStatus || filters.deploymentStatus) && (
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--pt-copper)]" />
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 z-50 w-64 bg-[var(--pt-surface)] border border-[var(--pt-border-bright)] rounded-lg p-4 shadow-2xl modal-animate">
            <div className="space-y-3">
              <SelectField label="Environment" value={filters.environment}
                           onChange={v => setFilters(p => ({ ...p, environment: v }))}
                           options={['', ...ENVIRONMENTS]} />
              <SelectField label="Testing Status" value={filters.testingStatus}
                           onChange={v => setFilters(p => ({ ...p, testingStatus: v }))}
                           options={['', ...TEST_STATUSES]} />
              <SelectField label="Deployment Status" value={filters.deploymentStatus}
                           onChange={v => setFilters(p => ({ ...p, deploymentStatus: v }))}
                           options={['', ...DEPLOY_STATUSES]} />
              <button onClick={() => { setFilters({ environment: '', testingStatus: '', deploymentStatus: '' }); setOpen(false) }}
                      className="w-full text-xs text-[var(--pt-text-muted)] hover:text-[var(--pt-copper)] transition-colors mt-2">
                Clear all filters
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/* ── main app ──────────────────────────────────── */

export default function PatchTracker() {
  const [patches, setPatches] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      return saved ? JSON.parse(saved) : SEED_PATCHES
    } catch { return SEED_PATCHES }
  })

  const [search, setSearch] = useState('')
  const [view, setView] = useState('All Patches')
  const [showModal, setShowModal] = useState(false)
  const [editPatch, setEditPatch] = useState(null)
  const [sortBy, setSortBy] = useState('releaseDate')
  const [sortDir, setSortDir] = useState('desc')
  const [filters, setFilters] = useState({ environment: '', testingStatus: '', deploymentStatus: '' })
  const [expandedRow, setExpandedRow] = useState(null)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(patches))
  }, [patches])

  const handleSort = useCallback((col) => {
    setSortBy(prev => {
      if (prev === col) { setSortDir(d => d === 'asc' ? 'desc' : 'asc'); return col }
      setSortDir('desc')
      return col
    })
  }, [])

  const handleSave = useCallback((patch) => {
    setPatches(prev => {
      const idx = prev.findIndex(p => p.id === patch.id)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = patch
        return next
      }
      return [patch, ...prev]
    })
    setShowModal(false)
    setEditPatch(null)
  }, [])

  const handleDelete = useCallback((id) => {
    setPatches(prev => prev.filter(p => p.id !== id))
  }, [])

  const handleEdit = useCallback((patch) => {
    setEditPatch(patch)
    setShowModal(true)
  }, [])

  const filteredPatches = useMemo(() => {
    let list = patches

    // view filter
    if (view === 'Recent') {
      const thirtyDaysAgo = new Date()
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
      list = list.filter(p => new Date(p.releaseDate) >= thirtyDaysAgo)
    }

    // search
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.responsiblePerson.toLowerCase().includes(q) ||
        p.filesChanged.toLowerCase().includes(q) ||
        p.environment.toLowerCase().includes(q)
      )
    }

    // filters
    if (filters.environment) list = list.filter(p => p.environment === filters.environment)
    if (filters.testingStatus) list = list.filter(p => p.testingStatus === filters.testingStatus)
    if (filters.deploymentStatus) list = list.filter(p => p.deploymentStatus === filters.deploymentStatus)

    // sort
    list = [...list].sort((a, b) => {
      let aVal = a[sortBy], bVal = b[sortBy]
      if (sortBy === 'preparedDate' || sortBy === 'releaseDate') {
        aVal = new Date(aVal); bVal = new Date(bVal)
      } else {
        aVal = (aVal || '').toLowerCase(); bVal = (bVal || '').toLowerCase()
      }
      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1
      return 0
    })

    return list
  }, [patches, search, view, filters, sortBy, sortDir])

  // Stats
  const stats = useMemo(() => ({
    total: patches.length,
    deployed: patches.filter(p => p.deploymentStatus === 'Deployed').length,
    passed: patches.filter(p => p.testingStatus === 'Passed').length,
    production: patches.filter(p => p.environment === 'Production').length,
  }), [patches])

  return (
    <div className="min-h-screen px-4 py-8 md:px-8 lg:px-12 max-w-[1400px] mx-auto">

      {/* ── header ──────────────────────── */}
      <header className="header-animate mb-8">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="p-2 rounded-lg bg-[var(--pt-copper-glow)] border border-[var(--pt-copper)]/20">
                <Bandage size={22} className="text-[var(--pt-copper)]" />
              </div>
              <h1 className="font-fraunces text-3xl md:text-4xl font-bold text-[var(--pt-text)] tracking-tight">
                Patch <span className="copper-underline text-[var(--pt-copper)]">Tracker</span>
              </h1>
            </div>
            <p className="text-sm text-[var(--pt-text-muted)] mt-2 ml-1">
              Track deployment patches across environments
            </p>
          </div>

          <button onClick={() => { setEditPatch(null); setShowModal(true) }}
                  className="btn-copper flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[var(--pt-copper)] text-[#080c18] font-medium text-sm hover:bg-[var(--pt-gold)] transition-colors self-start md:self-auto">
            <Plus size={16} strokeWidth={2.5} />
            New Patch
          </button>
        </div>

        {/* ── stats row ───────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <StatCard icon={FileText} label="Total Patches" value={stats.total} delay={100} />
          <StatCard icon={CheckCircle2} label="Deployed" value={stats.deployed} delay={200} />
          <StatCard icon={Shield} label="Passed" value={stats.passed} delay={300} />
          <StatCard icon={Server} label="In Production" value={stats.production} delay={400} />
        </div>

        {/* ── toolbar ─────────────────────── */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <ViewToggle view={view} setView={setView} />

          <div className="flex-1" />

          <div className="flex items-center gap-3">
            <FilterDropdown filters={filters} setFilters={setFilters} />

            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--pt-text-muted)]" />
              <input value={search} onChange={e => setSearch(e.target.value)}
                     placeholder="Search patches..."
                     className="pl-9 pr-4 py-2 text-xs rounded-md border border-[var(--pt-border)] bg-[var(--pt-surface)] text-[var(--pt-text)] input-copper placeholder:text-[var(--pt-text-muted)] w-56" />
              {search && (
                <button onClick={() => setSearch('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--pt-text-muted)] hover:text-[var(--pt-text)]">
                  <X size={12} />
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* ── table ──────────────────────────── */}
      <div className="pt-table-wrapper rounded-xl border border-[var(--pt-border)] bg-[var(--pt-surface)] overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-[var(--pt-border-bright)]">
              {[
                { key: 'name', label: 'Patch Name', icon: FileText },
                { key: 'preparedDate', label: 'Prepared', icon: Calendar },
                { key: 'releaseDate', label: 'Released', icon: Calendar },
                { key: 'environment', label: 'Environment', icon: Server },
                { key: 'testingStatus', label: 'Testing', icon: Shield },
                { key: 'deploymentStatus', label: 'Deployment', icon: CheckCircle2 },
                { key: 'responsiblePerson', label: 'Responsible', icon: User },
                { key: 'filesChanged', label: 'Files Changed', icon: FileText },
              ].map(col => (
                <th key={col.key}
                    className="px-4 py-3 text-[10px] uppercase tracking-wider text-[var(--pt-text-muted)] font-medium whitespace-nowrap">
                  <div className="flex items-center gap-1.5">
                    <col.icon size={11} className="text-[var(--pt-text-muted)] opacity-60" />
                    {col.label}
                    <SortButton column={col.key} sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                  </div>
                </th>
              ))}
              <th className="w-10"></th>
            </tr>
          </thead>
          <tbody>
            {filteredPatches.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-16 text-center">
                  <div className="text-[var(--pt-text-muted)] text-sm">
                    {search || filters.environment || filters.testingStatus || filters.deploymentStatus
                      ? 'No patches match your filters'
                      : 'No patches yet. Create your first patch!'}
                  </div>
                </td>
              </tr>
            ) : (
              filteredPatches.map((patch, i) => (
                <tr key={patch.id}
                    className="row-animate table-row-hover border-b border-[var(--pt-border)] last:border-b-0 cursor-pointer"
                    style={{ animationDelay: `${i * 50}ms` }}
                    onClick={() => setExpandedRow(expandedRow === patch.id ? null : patch.id)}>
                  {/* Patch Name */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <FileText size={14} className="text-[var(--pt-text-muted)] shrink-0" />
                      <span className="text-sm font-medium text-[var(--pt-text)] truncate max-w-[220px]">
                        {patch.name}
                      </span>
                    </div>
                  </td>
                  {/* Prepared Date */}
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs text-[var(--pt-text-muted)]">
                      {formatDateShort(patch.preparedDate)}
                    </span>
                  </td>
                  {/* Release Date */}
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs text-[var(--pt-text-muted)]">
                      {formatDateShort(patch.releaseDate)}
                    </span>
                  </td>
                  {/* Environment */}
                  <td className="px-4 py-3">
                    <Badge label={patch.environment} styles={ENV_STYLES[patch.environment]} />
                  </td>
                  {/* Testing Status */}
                  <td className="px-4 py-3">
                    <Badge label={patch.testingStatus} styles={TEST_STYLES[patch.testingStatus]} />
                  </td>
                  {/* Deployment Status */}
                  <td className="px-4 py-3">
                    <Badge label={patch.deploymentStatus} styles={DEPLOY_STYLES[patch.deploymentStatus]} />
                  </td>
                  {/* Responsible Person */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-[var(--pt-copper-glow)] border border-[var(--pt-copper)]/30 flex items-center justify-center text-[10px] font-medium text-[var(--pt-copper)]">
                        {patch.responsiblePerson ? patch.responsiblePerson.split(' ').map(n => n[0]).join('') : '?'}
                      </div>
                      <span className="text-xs text-[var(--pt-text)]">{patch.responsiblePerson || '—'}</span>
                    </div>
                  </td>
                  {/* Files Changed */}
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs text-[var(--pt-text-muted)] truncate block max-w-[180px]">
                      {patch.filesChanged || '—'}
                    </span>
                  </td>
                  {/* Actions */}
                  <td className="px-2 py-3">
                    <div className="delete-btn flex items-center gap-1">
                      <button onClick={(e) => { e.stopPropagation(); handleEdit(patch) }}
                              className="p-1.5 rounded-md hover:bg-[var(--pt-border)] transition-colors"
                              title="Edit">
                        <Edit3 size={13} className="text-[var(--pt-text-muted)]" />
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); handleDelete(patch.id) }}
                              className="p-1.5 rounded-md hover:bg-rose-500/15 transition-colors"
                              title="Delete">
                        <Trash2 size={13} className="text-rose-400/70" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ── footer info ─────────────────── */}
      <div className="mt-4 flex items-center justify-between px-1">
        <span className="text-[10px] text-[var(--pt-text-muted)] font-mono">
          {filteredPatches.length} of {patches.length} patches
        </span>
        <span className="text-[10px] text-[var(--pt-text-muted)]">
          Data stored in browser &middot; localStorage
        </span>
      </div>

      {/* ── modal ──────────────────────── */}
      {showModal && (
        <PatchModal
          patch={editPatch}
          onSave={handleSave}
          onClose={() => { setShowModal(false); setEditPatch(null) }}
        />
      )}
    </div>
  )
}
