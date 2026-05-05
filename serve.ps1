$path = 'C:\Users\RakeshJain\.gemini\antigravity\scratch\real_estate_offer_portal'
$port = 3000
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()
Write-Host "Server running at http://localhost:$port/ - Keep this terminal open!"

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $req = $context.Request
        $res = $context.Response
        
        $localPath = $req.Url.LocalPath
        if ($localPath -eq '/') { $localPath = '/index.html' }
        $filePath = Join-Path $path $localPath
        
        if (Test-Path $filePath -PathType Leaf) {
            $ext = [System.IO.Path]::GetExtension($filePath)
            if ($ext -eq '.html') { $res.ContentType = 'text/html; charset=utf-8' }
            elseif ($ext -eq '.js') { $res.ContentType = 'application/javascript' }
            elseif ($ext -eq '.css') { $res.ContentType = 'text/css' }
            
            $res.AddHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
            $res.AddHeader("Pragma", "no-cache")
            $res.AddHeader("Expires", "0")
            
            $content = [System.IO.File]::ReadAllBytes($filePath)
            $res.ContentLength64 = $content.Length
            $res.OutputStream.Write($content, 0, $content.Length)
        } else {
            $res.StatusCode = 404
        }
        $res.Close()
    }
} catch {
    Write-Host "Server stopped."
} finally {
    $listener.Stop()
}
