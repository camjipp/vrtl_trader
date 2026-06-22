create extension if not exists pgcrypto;

create table if not exists public.bot_scans (
  id uuid primary key default gen_random_uuid(),
  ts timestamptz not null,
  venue text not null default 'polymarket',
  fetched integer not null default 0,
  parsed integer not null default 0,
  normalized integer not null default 0,
  families integer not null default 0,
  bucket_families integer not null default 0,
  bucket_families_with_6_valid_prices integer not null default 0,
  pages_fetched integer not null default 0,
  stop_reason text,
  top_score numeric,
  limits jsonb not null default '{}'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  top_families jsonb not null default '[]'::jsonb,
  paper_arb jsonb,
  created_at timestamptz not null default now()
);

create index if not exists bot_scans_ts_idx on public.bot_scans (ts desc);

create table if not exists public.arb_opportunities (
  id uuid primary key default gen_random_uuid(),
  ts timestamptz not null,
  venue text not null default 'polymarket',
  strategy text not null,
  market_id text not null,
  title text not null,
  yes_ask numeric,
  no_ask numeric,
  shares numeric,
  cost_usd numeric,
  locked_profit_usd numeric,
  edge numeric,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists arb_opportunities_ts_idx on public.arb_opportunities (ts desc);
create index if not exists arb_opportunities_market_idx on public.arb_opportunities (market_id, ts desc);

create table if not exists public.paper_arb_trades (
  id uuid primary key default gen_random_uuid(),
  source_event_id text unique,
  ts timestamptz not null,
  event_type text not null check (event_type in ('ENTRY', 'MARK', 'EXIT')),
  position_id text,
  venue text not null default 'polymarket',
  market_id text,
  title text,
  shares numeric,
  cost_usd numeric,
  locked_profit_usd numeric,
  edge numeric,
  realized_pnl_usd numeric,
  mark_pnl_usd numeric,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists paper_arb_trades_ts_idx on public.paper_arb_trades (ts desc);
create index if not exists paper_arb_trades_position_idx on public.paper_arb_trades (position_id, ts desc);

create table if not exists public.paper_arb_positions (
  position_id text primary key,
  venue text not null default 'polymarket',
  market_id text not null,
  title text not null,
  entry_ts timestamptz not null,
  shares numeric not null,
  cost_usd numeric not null,
  locked_profit_usd numeric not null,
  last_mark_pnl_usd numeric,
  status text not null default 'open',
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists paper_arb_positions_status_idx on public.paper_arb_positions (status, updated_at desc);

create table if not exists public.bot_heartbeats (
  id uuid primary key default gen_random_uuid(),
  ts timestamptz not null,
  worker_id text not null,
  mode text not null,
  status text not null,
  message text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists bot_heartbeats_ts_idx on public.bot_heartbeats (ts desc);

alter table public.bot_scans enable row level security;
alter table public.arb_opportunities enable row level security;
alter table public.paper_arb_trades enable row level security;
alter table public.paper_arb_positions enable row level security;
alter table public.bot_heartbeats enable row level security;
