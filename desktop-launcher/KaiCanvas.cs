using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

[assembly: AssemblyTitle("KAI画布V1版")]
[assembly: AssemblyDescription("KAI画布 V1 Windows 客户端")]
[assembly: AssemblyCompany("KAI")]
[assembly: AssemblyProduct("KAI画布")]
[assembly: AssemblyCopyright("Copyright © KAI 2026")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

internal static class KaiCanvas
{
    private const string CanvasUrl = "https://xiaokai-web-production.up.railway.app/";

    private static string FindBrowser()
    {
        string programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        string programFilesX86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
        string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        string[] candidates =
        {
            Path.Combine(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
            Path.Combine(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
            Path.Combine(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
            Path.Combine(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
            Path.Combine(localAppData, "Google", "Chrome", "Application", "chrome.exe")
        };
        foreach (string candidate in candidates)
        {
            if (File.Exists(candidate)) return candidate;
        }
        return null;
    }

    [STAThread]
    private static void Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        try
        {
            string browser = FindBrowser();
            if (!string.IsNullOrEmpty(browser))
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = browser,
                    Arguments = "--app=\"" + CanvasUrl + "\" --start-maximized",
                    UseShellExecute = true
                });
                return;
            }
            Process.Start(new ProcessStartInfo
            {
                FileName = CanvasUrl,
                UseShellExecute = true
            });
        }
        catch (Exception error)
        {
            MessageBox.Show(
                "无法打开 KAI画布 V1。请确认电脑已联网，然后重试。\n\n" + error.Message,
                "KAI画布 V1",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error
            );
        }
    }
}
