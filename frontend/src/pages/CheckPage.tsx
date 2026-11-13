import CheckerPanel from "../components/CheckerPanel";
import Hero from "../components/Hero";

export default function CheckPage() {
  return (
    <>
      <Hero title="Check a trip file" sub="Test any exported package against every travel rule before you share or book it." />
      <main className="page page--narrow">
        <CheckerPanel />
      </main>
    </>
  );
}
