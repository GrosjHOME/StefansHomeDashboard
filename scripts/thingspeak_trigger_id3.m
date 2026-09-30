% Loest den GitHub-Workflow "ID.3 SoC (Tibber) -> ThingSpeak" (id3-tibber.yml)
% per workflow_dispatch aus. Gedacht als ThingSpeak "MATLAB Analysis", die von
% einer TimeControl alle 15 Minuten gestartet wird - zuverlaessiger als der
% GitHub-Zeitplan, der geplante Laeufe unter Last verzoegert oder verwirft.
%
% Einrichtung: siehe README, Abschnitt "ID.3-Poller zuverlaessig ausloesen".
%
% ACHTUNG: Das Repo ist oeffentlich. Den echten Token NUR in ThingSpeak
% eintragen, diese Datei im Repo behaelt den Platzhalter.

GH_PAT = 'github_pat_HIER_EINTRAGEN';  % Fine-grained PAT: nur dieses Repo, "Actions: Read and write"

url = ['https://api.github.com/repos/GrosjHOME/StefansHomeDashboard/' ...
       'actions/workflows/id3-tibber.yml/dispatches'];

opts = weboptions( ...
    'RequestMethod', 'post', ...
    'MediaType',     'application/json', ...   % Body als JSON senden
    'ContentType',   'text', ...               % Antwort ist leer (HTTP 204)
    'Timeout',       15, ...
    'UserAgent',     'thingspeak-timecontrol', ...
    'HeaderFields',  {'Authorization',        ['Bearer ' GH_PAT]; ...
                      'Accept',               'application/vnd.github+json'; ...
                      'X-GitHub-Api-Version', '2022-11-28'});

try
    webwrite(url, struct('ref', 'main'), opts);
    fprintf('ID.3-Workflow ausgeloest (%s).\n', datestr(now, 'dd.mm.yyyy HH:MM'));
catch err
    % 401 = Token ungueltig/abgelaufen, 403 = fehlende Berechtigung "Actions: write",
    % 404 = Repo/Workflow-Name falsch oder Token hat keinen Zugriff aufs Repo
    error('Ausloesen fehlgeschlagen: %s', err.message);
end
