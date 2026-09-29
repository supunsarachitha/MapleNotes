namespace MapleNotes.Server.Domain;

/// <summary>
/// An entity protected against lost updates by optimistic concurrency. <see cref="Revision"/> is a concurrency
/// token: every update is conditional on the revision that was read, and <c>MapleDbContext</c> increments it on each
/// save. If two writers race (for example the user editing a note while the background encryption worker converts
/// it), the second save fails instead of silently overwriting the first.
/// </summary>
public interface IRevisioned
{
    /// <summary>Incremented on every update.</summary>
    int Revision { get; set; }
}
