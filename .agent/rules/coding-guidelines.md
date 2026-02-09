# Coding Guidelines

## General Principles
- **KISS (Keep It Simple, Stupid)**: 複雑さを避け、可読性を重視する。
- **Type Safety**: 型定義を詳細に行い、`any` の使用は極力避ける。
- **Consistency**: 既存のコードスタイルと言語標準に従う。

## Frontend (Next.js + TypeScript + Tailwind)
- **Component Style**:
  - Use Functional Components and Hooks.
  - One component per file (`PascalCase.tsx`).
  - Use Server Components by default; add `"use client"` only when interactivity is needed.
- **State Management**:
  - Use URL search params for bookmarkable state where possible.
  - Use `React Context` or `Zustand` for global client state.
  - Use `SWR` or `React Query` for data fetching.
- **Styling**:
  - Use `TailwindCSS` utility classes.
  - Use `clsx` and `tailwind-merge` for conditional class names.
  - Use `ShadcnUI` components for consistency.
- **Linting**:
  - Follow `eslint` and `prettier` rules.

## Backend (Go)
- **Code Style**:
  - Run `go fmt` and `go vet` before committing.
  - Follow standard Go conventions (Effective Go).
- **Error Handling**:
  - Return errors explicitly; avoid panics.
  - Wrap errors with context: `fmt.Errorf("failed to ...: %w", err)`.
- **Concurrency**:
  - Use `Goroutines` and `Channels` for concurrent tasks.
  - Always use `context.Context` for cancellation and timeout.
- **Database**:
  - Use `pgx` for PostgreSQL interactions.
  - Use `sqlc` or raw SQL with strict typing for complex queries if needed.
  - Use `TimescaleDB` features for time-series data.

## Documentation
- **Comments**:
  - Explain "WHY", not "WHAT".
- **Go Docs**:
  - exported functions and types must have a comment starting with their name.
