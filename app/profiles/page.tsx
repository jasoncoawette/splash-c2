import VesselProfile from "../components/vessel/VesselProfile";

export default function Profiles() {
  return (
    <main className="profile-sheet">
      <header>
        <p className="eyebrow">Splash C2 · platform drawings</p>
        <h1>Vessel classes</h1>
        <p className="profile-note">
          Side elevation and plan, generated from the same geometry the chart and
          the helm draw. One family, one hull form: the Typhoon carries a sensor
          tower, the Tempest carries payload.
        </p>
      </header>

      <div className="profile-grid">
        <VesselProfile type="TYPHOON" />
        <VesselProfile type="TEMPEST" />
      </div>
    </main>
  );
}
