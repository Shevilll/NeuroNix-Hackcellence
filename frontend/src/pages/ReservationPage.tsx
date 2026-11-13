import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getReservation, type TripPackage } from "../api/endpoints";
import Hero from "../components/Hero";
import Icon from "../components/Icon";
import PackageView from "../components/PackageView";
import ReservationCard from "../components/ReservationCard";
import Spinner from "../components/Spinner";

type State = { kind: "idle" } | { kind: "loading" } | { kind: "missing"; number: string } | { kind: "found"; number: string; pkg: TripPackage };

/** M7: a reservation number opens the summary of the whole package; a wrong number says "not found". */
export default function ReservationPage() {
  const { number } = useParams();
  const navigate = useNavigate();
  const [text, setText] = useState(number ?? "");
  const [formatError, setFormatError] = useState<string | null>(null);
  const [state, setState] = useState<State>({ kind: "idle" });

  useEffect(() => {
    if (!number) {
      setState({ kind: "idle" });
      return;
    }
    let live = true;
    setText(number);
    setState({ kind: "loading" });
    getReservation(number).then(
      (r) => live && setState({ kind: "found", number: r.reservation_number, pkg: r.package }),
      () => live && setState({ kind: "missing", number }),
    );
    return () => {
      live = false;
    };
  }, [number]);

  function open(event: FormEvent) {
    event.preventDefault();
    const n = text.replace(/\s/g, "");
    if (!/^\d{10}$/.test(n)) {
      setFormatError("A reservation number has exactly 10 digits.");
      return;
    }
    setFormatError(null);
    navigate(`/r/${n}`);
  }

  return (
    <>
      <Hero title="Find your booking" sub="Enter the 10-digit reservation number you got when you confirmed.">
        <form className="lookup" onSubmit={open} noValidate>
          <label htmlFor="reservation-number" className="sr-only">
            Reservation number
          </label>
          <div className="lookup__field">
            <Icon name="search" />
            <input
              id="reservation-number"
              value={text}
              inputMode="numeric"
              autoComplete="off"
              maxLength={12}
              placeholder="e.g. 4435693622"
              aria-invalid={formatError ? true : undefined}
              aria-describedby={formatError ? "reservation-number-error" : undefined}
              onChange={(e) => setText(e.target.value)}
            />
          </div>
          <button type="submit" className="btn btn--primary">
            Open
          </button>
          {formatError && (
            <p id="reservation-number-error" className="lookup__error">
              {formatError}
            </p>
          )}
        </form>
      </Hero>
      <main className="page">
        {state.kind === "loading" && (
          <div className="card">
            <Spinner label="Opening your reservation…" showLabel />
          </div>
        )}
        {state.kind === "missing" && (
          <div className="card notice" role="alert">
            <p className="notice__title">Reservation not found</p>
            <p className="notice__text">
              There is no booking with the number {state.number}. Check the 10 digits and try again.
            </p>
          </div>
        )}
        {state.kind === "found" && (
          <>
            <ReservationCard number={state.number} pkg={state.pkg} showPrint />
            <PackageView pkg={state.pkg} budget={state.pkg.budget_inr} eyebrow="Booked holiday" />
          </>
        )}
      </main>
    </>
  );
}
