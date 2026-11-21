import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({ component: Landing });

/** The bare domain says nothing about any course; everything lives behind a link. */
function Landing() {
  return (
    <main className="page">
      <header className="masthead">
        <div className="topline">
          <span className="for">for you</span>
        </div>
        <p className="date">Date</p>
        <h1>코스를 준비하고 있어</h1>
        <p className="lede">받은 링크로 들어와 줘.</p>
      </header>
    </main>
  );
}
