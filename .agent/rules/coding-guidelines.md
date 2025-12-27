# Coding Guidelines

## General Principles
- **KISS (Keep It Simple, Stupid)**: 複雑さを避け、可読性を重視する。
- **Type Safety**: 型定義を詳細に行い、`any` の使用は極力避ける。
- **Consistency**: 既存のコードスタイルと言語標準に従う。

## Frontend (React + TypeScript + Tailwind)
- **Component Style**:
  - 関数コンポーネント (Function Components) と Hooks を使用する。
  - 1ファイル1コンポーネントを基本とする。
  - ファイル名は `PascalCase.tsx`。
- **State Management**:
  - ローカルステートには `useState`。
  - サーバー状態には `TanStack Query` を使用し、`useEffect` でのデータフェッチは避ける。
  - グローバルステートが必要な場合は `Zustand` を検討する。
- **Styling**:
  - `TailwindCSS` のユーティリティクラスを使用する。
  - 複雑なスタイル条件には `clsx` や `tailwind-merge` を活用する。
- **Linting**:
  - `eslint` のルールに従う。

## Backend (FastAPI + Python)
- **Code Style**:
  - `Ruff` を使用してフォーマットとLintを行う。
  - PEP 8 に準拠する。
- **Async/Await**:
  - I/O処理（DBアクセス、HTTPリクエスト）は必ず `async/await` で非同期化する。
- **Type Hinting**:
  - すべての関数引数と戻り値に型ヒントを付ける。
  - Pydantic モデルを使用してリクエスト/レスポンスのバリデーションを行う。
- **Database**:
  - SQLAlchemy の ORM モデルを使用する。
  - 生SQLは避け、クエリビルダを使用する。

## Documentation
- **Comments**:
  - 複雑なロジックには "なぜそうしたか" を説明するコメントを残す。
- **Docstrings**:
  - 公開関数やAPIエンドポイントには目的と引数/戻り値を説明する docstrings を記述する。
