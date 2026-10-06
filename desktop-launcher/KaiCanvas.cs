using System;
using System.Diagnostics;
using System.Windows.Forms;

internal static class KaiCanvas
{
    private const string CanvasUrl = "https://xiaokai-web-production.up.railway.app/";

    [STAThread]
    private static void Main()
    {
        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = CanvasUrl,
                UseShellExecute = true
            });
        }
        catch (Exception error)
        {
            MessageBox.Show(
                "无法打开 KAI 无限画布。请确认电脑已联网，然后重试。\n\n" + error.Message,
                "KAI 无限画布",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error
            );
        }
    }
}
