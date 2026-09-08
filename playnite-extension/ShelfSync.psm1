# Shelf Sync - envia tempo jogado, status e nota do Playnite para o Shelf.
#
# Quando envia:
#   1. Todo dia as 21h, varre a biblioteca inteira e envia (com as notas atuais).
#      Precisa do Playnite aberto as 21h. Se estiver fechado, faz o envio atrasado
#      na proxima vez que voce abrir o Playnite (se ja passou das 21h e nao sincronizou
#      naquele dia).
#   2. Ao fechar um jogo, envia aquele jogo apos 30 segundos (pega tempo/status na hora;
#      a nota que voce der depois entra no envio das 21h).
#
# Configuracao: crie um arquivo "config.json" nesta mesma pasta com o conteudo:
#   { "WebhookUrl": "http://SEU-SHELF:3000/api/integrations/playnite/webhook?token=SEU_TOKEN" }
# (copie a URL exata no Shelf -> Configuracoes -> Integracoes -> Playnite -> Copiar)
#
# Opcional no config.json: "DailyHour": 21  (hora do envio diario, 0-23; padrao 21)
#
# Um config.json separado sobrevive a atualizacoes da extensao (o .psm1 pode ser sobrescrito).

$global:ShelfDailyTimer  = $null
$global:ShelfCloseTimers = New-Object System.Collections.ArrayList
$global:ShelfSyncing     = $false

function Get-ShelfConfig {
    $cfgPath = Join-Path $PSScriptRoot "config.json"
    if (Test-Path $cfgPath) {
        try { return (Get-Content $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json) }
        catch { $__logger.Error("ShelfSync: config.json invalido - $($_.Exception.Message)") }
    }
    return $null
}

function Get-ShelfWebhookUrl {
    $cfg = Get-ShelfConfig
    if ($cfg -and $cfg.WebhookUrl) { return [string]$cfg.WebhookUrl }
    return $null
}

function Get-ShelfDailyHour {
    $cfg = Get-ShelfConfig
    if ($cfg -and $null -ne $cfg.DailyHour) {
        try { $h = [int]$cfg.DailyHour; if ($h -ge 0 -and $h -le 23) { return $h } } catch {}
    }
    return 21
}

function Get-StatePath { return (Join-Path $PSScriptRoot "shelfsync-state.json") }

function Get-LastDailySync {
    $p = Get-StatePath
    if (Test-Path $p) {
        try { return [string]((Get-Content $p -Raw -Encoding UTF8 | ConvertFrom-Json).LastDailySync) } catch {}
    }
    return $null
}

function Set-LastDailySync {
    param($dateStr)
    try { @{ LastDailySync = $dateStr } | ConvertTo-Json | Set-Content -Path (Get-StatePath) -Encoding UTF8 } catch {}
}

function Send-ShelfGame {
    param($game)

    if ($null -eq $game) { return }
    $url = Get-ShelfWebhookUrl
    if (-not $url) {
        $__logger.Warn("ShelfSync: WebhookUrl nao configurada (crie o config.json). Jogo ignorado: $($game.Name)")
        return
    }

    $completion = $null
    if ($game.CompletionStatus) { $completion = [string]$game.CompletionStatus.Name }

    $score = $null
    if ($null -ne $game.UserScore) { $score = [int]$game.UserScore }

    $year = $null
    if ($game.ReleaseDate -and $game.ReleaseDate.Year) { $year = [int]$game.ReleaseDate.Year }

    $lastPlayed = $null
    if ($null -ne $game.LastActivity) {
        try { $lastPlayed = ([datetime]$game.LastActivity).ToUniversalTime().ToString("o") } catch {}
    }

    $payload = @{
        gameId           = $game.Id.ToString()
        name             = [string]$game.Name
        playtimeSeconds  = [int64]$game.Playtime
        completionStatus = $completion
        userScore        = $score
        releaseYear      = $year
        lastPlayed       = $lastPlayed
    }

    try {
        $json  = $payload | ConvertTo-Json -Compress
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
        Invoke-RestMethod -Uri $url -Method Post -Body $bytes -ContentType "application/json; charset=utf-8" -TimeoutSec 15 | Out-Null
        $__logger.Info("ShelfSync: enviado '$($game.Name)' ($([math]::Round($game.Playtime/3600,1))h, $completion)")
    } catch {
        $__logger.Error("ShelfSync: falha ao enviar '$($game.Name)' - $($_.Exception.Message)")
    }
}

# Varre a biblioteca e envia tudo com tempo jogado ou nota. Sem UI (usado pelos timers).
function Send-AllGames {
    if ($global:ShelfSyncing) { return 0 }
    $global:ShelfSyncing = $true
    $sent = 0
    try {
        foreach ($g in $PlayniteApi.Database.Games) {
            if ($g.Playtime -gt 0 -or $null -ne $g.UserScore) {
                Send-ShelfGame $g
                $sent++
            }
        }
        $__logger.Info("ShelfSync: sincronizacao enviou $sent jogos")
    } finally {
        $global:ShelfSyncing = $false
    }
    return $sent
}

# Decide se deve sincronizar agora e, se sim, sincroniza.
#   - Durante o dia (timer): so quando ja passou da hora do envio (>= 21h) e nao sincronizou hoje.
#   - Na abertura do Playnite (isStartup): tambem sincroniza se um dia inteiro foi pulado
#     (Playnite ficou fechado na hora do envio) ou se nunca sincronizou - mesmo antes das 21h.
function Invoke-DailySyncIfDue {
    param([bool]$isStartup = $false)

    $now   = Get-Date
    $today = $now.ToString("yyyy-MM-dd")
    $last  = Get-LastDailySync
    if ($last -eq $today) { return }

    $due = $false
    if ($now.Hour -ge (Get-ShelfDailyHour)) {
        $due = $true
    } elseif ($isStartup) {
        $yesterday = $now.AddDays(-1).ToString("yyyy-MM-dd")
        if ($last -ne $yesterday) { $due = $true }
    }

    if ($due) {
        [void](Send-AllGames)
        Set-LastDailySync $today
    }
}

function OnApplicationStarted {
    param($evnArgs)

    try { Invoke-DailySyncIfDue $true } catch { $__logger.Error("ShelfSync: catch-up falhou - $($_.Exception.Message)") }

    $t = New-Object System.Timers.Timer
    $t.Interval = 60000
    $t.AutoReset = $true
    $t.add_Elapsed({
        param($s, $e)
        try { Invoke-DailySyncIfDue } catch { $__logger.Error("ShelfSync: envio diario falhou - $($_.Exception.Message)") }
    })
    $t.Start()
    $global:ShelfDailyTimer = $t
    $__logger.Info("ShelfSync: timer diario ativo (hora $(Get-ShelfDailyHour)h)")
}

function OnApplicationStopped {
    param($evnArgs)
    if ($global:ShelfDailyTimer) {
        try { $global:ShelfDailyTimer.Stop(); $global:ShelfDailyTimer.Dispose() } catch {}
        $global:ShelfDailyTimer = $null
    }
}

# Ao fechar um jogo: envia aquele jogo apos 30 segundos.
function OnGameStopped {
    param($evnArgs)
    $game = $evnArgs.Game
    if ($null -eq $game) { return }

    $timer = New-Object System.Timers.Timer
    $timer.Interval = 30000
    $timer.AutoReset = $false
    $handler = {
        param($s, $e)
        try { Send-ShelfGame $game } catch { $__logger.Error("ShelfSync: envio ao fechar falhou - $($_.Exception.Message)") }
        try { $s.Dispose(); [void]$global:ShelfCloseTimers.Remove($s) } catch {}
    }.GetNewClosure()
    $timer.add_Elapsed($handler)
    [void]$global:ShelfCloseTimers.Add($timer)
    $timer.Start()
    $__logger.Info("ShelfSync: envio de '$($game.Name)' agendado em 30 s")
}

# Item no menu de contexto do jogo: reenvia sob demanda (util depois de dar nota
# ou marcar como concluido sem esperar o envio diario).
function GetGameMenuItems {
    param($menuArgs)
    $item = New-Object Playnite.SDK.Plugins.ScriptGameMenuItem
    $item.Description  = "Enviar ao Shelf"
    $item.FunctionName = "Send-SelectedGamesToShelf"
    $item.MenuSection  = "Shelf"
    return $item
}

function Send-SelectedGamesToShelf {
    param($scriptArgs)
    foreach ($g in $scriptArgs.Games) { Send-ShelfGame $g }
}

# Item no menu principal: sincroniza toda a biblioteca de uma vez (seguro repetir).
function GetMainMenuItems {
    param($menuArgs)
    $item = New-Object Playnite.SDK.Plugins.ScriptMainMenuItem
    $item.Description  = "Sincronizar tudo com o Shelf"
    $item.FunctionName = "Sync-AllGamesToShelf"
    $item.MenuSection  = "@Shelf"
    return $item
}

function Sync-AllGamesToShelf {
    param($scriptArgs)
    $sent = Send-AllGames
    $PlayniteApi.Dialogs.ShowMessage("Enviados $sent jogos ao Shelf.", "Shelf Sync")
}
