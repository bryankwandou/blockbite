// BlockBite for Windows: opens the live game in its own app window (no tabs, no address bar).
// Uses Edge (on every Windows 10/11) or Chrome in --app mode with the person's normal browser
// profile, so wallet extensions like Phantom and Solflare keep working. Falls back to the
// default browser if neither is installed.
// Build: csc /target:winexe /win32icon:blockbite.ico /out:BlockBite.exe BlockBite.cs
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;

[assembly: AssemblyTitle("BlockBite")]
[assembly: AssemblyProduct("BlockBite")]
[assembly: AssemblyDescription("Block puzzle on Solana")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

static class BlockBite
{
    const string Url = "https://blockbite.vercel.app/?source=windows";

    static string Find(params string[] relative)
    {
        string[] roots = {
            Environment.GetEnvironmentVariable("ProgramFiles(x86)"),
            Environment.GetEnvironmentVariable("ProgramFiles"),
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        };
        foreach (var root in roots)
        {
            if (string.IsNullOrEmpty(root)) continue;
            foreach (var rel in relative)
            {
                var p = Path.Combine(root, rel);
                if (File.Exists(p)) return p;
            }
        }
        return null;
    }

    [STAThread]
    static void Main()
    {
        var browser = Find(@"Microsoft\Edge\Application\msedge.exe", @"Google\Chrome\Application\chrome.exe");
        try
        {
            if (browser != null)
                Process.Start(new ProcessStartInfo(browser, "--app=" + Url + " --window-size=480,900") { UseShellExecute = false });
            else
                Process.Start(new ProcessStartInfo(Url) { UseShellExecute = true });
        }
        catch (Exception)
        {
            Process.Start(new ProcessStartInfo(Url) { UseShellExecute = true });
        }
    }
}
