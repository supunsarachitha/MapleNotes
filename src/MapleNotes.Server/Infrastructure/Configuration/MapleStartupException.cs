namespace MapleNotes.Server.Infrastructure.Configuration;

/// <summary>
/// A configuration or environment problem that prevents Maple Notes from starting.
/// </summary>
/// <remarks>
/// The message is printed to the operator verbatim (without a stack trace), so it must say what is wrong and how to
/// fix it, and it must never contain secret values.
/// </remarks>
/// <param name="message">Actionable description of the problem.</param>
/// <param name="innerException">The underlying error, if any.</param>
public sealed class MapleStartupException(string message, Exception? innerException = null)
    : Exception(message, innerException);
