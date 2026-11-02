// bokbok.exe — 로컬 서버(node server.js)를 띄우고 앱 창을 연다.
// 빌드: csc /target:winexe /out:bokbok.exe launcher.cs
using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Threading;
using System.Windows.Forms;

class Bokbok
{
    const string URL = "http://127.0.0.1:3600/";
    const string FALLBACK = @"C:\Users\jjang\Desktop\애드포스트 프로젝트\_도구\bokbok_app";

    static bool Up()
    {
        try
        {
            // v2는 로그인 전 401을 돌려주므로, HTTP 응답이 오기만 하면 켜진 것으로 본다
            var req = (HttpWebRequest)WebRequest.Create(URL + "api/auth/me");
            req.Timeout = 1500;
            using (req.GetResponse()) return true;
        }
        catch (WebException e) { if (e.Response != null) { e.Response.Close(); return true; } return false; }
        catch { return false; }
    }

    static string Find(string exe, params string[] dirs)
    {
        foreach (var d in dirs) { var p = Path.Combine(d, exe); if (File.Exists(p)) return p; }
        foreach (var d in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(';'))
        {
            try { var p = Path.Combine(d.Trim(), exe); if (File.Exists(p)) return p; } catch { }
        }
        return null;
    }

    [STAThread]
    static void Main()
    {
        if (!Up())
        {
            var dir = AppDomain.CurrentDomain.BaseDirectory;
            if (!File.Exists(Path.Combine(dir, "server.js"))) dir = FALLBACK;
            var node = Find("node.exe", @"C:\Program Files\nodejs");
            if (node == null) { MessageBox.Show("node.exe를 찾지 못했습니다. Node.js 설치를 확인하세요.", "bokbok"); return; }
            var psi = new ProcessStartInfo(node, "server.js")
            {
                WorkingDirectory = dir, UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardOutput = true, RedirectStandardError = true,
            };
            Process.Start(psi);
            for (int i = 0; i < 40 && !Up(); i++) Thread.Sleep(250);
            if (!Up()) { MessageBox.Show("bokbok 서버가 시작되지 않았습니다.\n" + dir, "bokbok"); return; }
        }
        // 앱처럼 주소창 없는 창으로 (Edge가 없으면 기본 브라우저)
        var edge = Find("msedge.exe", @"C:\Program Files (x86)\Microsoft\Edge\Application", @"C:\Program Files\Microsoft\Edge\Application");
        if (edge != null) Process.Start(edge, "--app=" + URL + " --window-size=1600,1000 --start-maximized");
        else Process.Start(URL);
    }
}
