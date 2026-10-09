% HSH-Auslastung: Anteil der Zeit, in der die Holzschnitzelheizung in den letzten 6 Stunden
% gebrannt hat (0-100 %). ThingSpeak: Apps > MATLAB Analysis, dazu TimeControl stuendlich.
%
% Liest den Heizungs-Kanal (Kessel oben = Feld 1, Abgas = Feld 8) und schreibt das Ergebnis in
% Feld 1 des Wallbox-Kanals (172228, "HSH-Auslastung") - das Dashboard zeigt es als "Ø Auslastung".
%
% Ersetzt die alte Formel   mean(Abgas) - 1.1*min(Abgas) - 0.7*max(0, max-200)   (siehe README,
% Abschnitt "HSH-Auslastung"): Sie war ein Temperatur-Mass und kein Zeitanteil, wurde nach jedem
% Neustart der Heizung ~6 h lang durch den kalten Anlauf verfaelscht, fiel bei Dauerbetrieb gegen 0
% und war bei Fuehler-Lesefehlern (0.0, -127) unbrauchbar.
%
% Brennt = Abgas - Kessel oben ueber 30 K (Beginn), bis es unter 20 K faellt (Ende) - dieselbe
% Zaehlung wie "Heizzyklen" und "Brennzeit" im Dashboard. Zeitgewichtet: Jede Messung gilt bis zur
% naechsten, hoechstens 3 min; fehlende Daten zaehlen als "nicht gebrannt".
%
% ACHTUNG: Die Schluessel (API Keys) gehoeren NICHT ins Repo (oeffentlich!) - hier nur Platzhalter,
% im ThingSpeak-Skript die echten Werte eintragen.

readChannelID  = 172428;
readAPIKey     = '<READ_API_KEY_HEIZUNG>';
writeChannelID = 172228;
writeAPIKey    = '<WRITE_API_KEY_WALLBOX>';

FENSTER_MIN = 360;     % Zeitfenster in Minuten (6 h, wie bisher 360 Punkte)
START_K     = 30;      % Abgas - Kessel ueber 30 K: Brennphase beginnt
ENDE_K      = 20;      % ... und endet unter 20 K
MAX_LUECKE_S = 180;    % laengste Zeit, die eine Messung gilt

%% Daten lesen: Zeitfenster statt "letzte 360 Eintraege" (die konnten Tage/Monate zurueckreichen)
[data, ts] = thingSpeakRead(readChannelID, 'Fields', [1 8], 'NumMinutes', FENSTER_MIN, 'ReadKey', readAPIKey);

%% Auslastung berechnen
if isempty(data)
    auslastung = 0;                     % Heizung sendet nicht (Sommer / aus)
else
    kessel = data(:,1);
    abgas  = data(:,2);
    % Fuehler-Lesefehler ausschliessen: 0.0 und -127 (Kessel), Abgasspitzen ueber 400 Grad
    ok = ~isnan(kessel) & ~isnan(abgas) & kessel > 0 & kessel < 150 & abgas > -100 & abgas < 400;
    kessel = kessel(ok);  abgas = abgas(ok);  ts = ts(ok);

    brennt = false(size(kessel));
    an = false;
    for i = 1:numel(kessel)
        d = abgas(i) - kessel(i);
        if ~an && d > START_K
            an = true;
        elseif an && d < ENDE_K
            an = false;
        end
        brennt(i) = an;
    end

    if numel(kessel) < 2
        auslastung = 0;
    else
        dauer = [seconds(diff(ts)); 60];          % Sekunden bis zur naechsten Messung
        dauer = min(dauer, MAX_LUECKE_S);
        auslastung = 100 * sum(dauer(brennt)) / (FENSTER_MIN * 60);
    end
end
auslastung = min(max(auslastung, 0), 100);
auslastung = round(auslastung, 1);
display(auslastung, 'Auslastung in %')

%% Schreiben (mit Wiederholung)
% ThingSpeak nimmt pro Kanal nur alle 15 s einen Wert an. In den Wallbox-Kanal schreibt aber auch der
% Arduino jede Minute - kollidiert das, wird der Wert abgelehnt (daher fehlte etwa jede vierte Stunde).
for versuch = 1:3
    try
        thingSpeakWrite(writeChannelID, auslastung, 'WriteKey', writeAPIKey);
        break
    catch err
        display(err.message, 'Schreiben fehlgeschlagen');
        pause(16);
    end
end
