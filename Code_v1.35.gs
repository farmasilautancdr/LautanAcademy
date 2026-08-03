// --- BOUND CONFIGURATION ---
// v1.4: Fresh-deploy placeholders. Create two NEW Drive folders (see the
// deployment guide) and paste their IDs below before running anything.
const PARENT_FOLDER_ID = "PASTE_YOUR_STAFF_RECORDS_FOLDER_ID_HERE"; 
// v1.3: Dedicated folder for reference Docs/Slides/Sheets/PDFs that supervisors
// drop in directly — kept separate from the staff record folders above.
// Create a folder in Drive, open it, copy the ID from the URL
// (drive.google.com/drive/folders/THIS_PART), and paste it below.
const REFERENCE_FOLDER_ID = "PASTE_YOUR_REFERENCE_FOLDER_ID_HERE"; 
const SS = SpreadsheetApp.getActiveSpreadsheet(); 
// v1.23: set by getReferenceDocs() each time it runs, surfaced in doGet() so
// the Resources sync can be diagnosed from inside the app itself, not just
// Apps Script's execution log.
let lastResourceSyncStats = null; 

/**
 * WEB APP INTERFACE: Synchronized with Lautan Academy v1.32
 * Provides Unified Data (Live + Archive + Knowledge Base + Quiz Settings
 * + Outlet Notes + AI Practice Results) for Staff, Outlet Managers,
 * Area Managers and Supervisors.
 */
function doGet() {
  // v1.26: doGet() now only returns what's genuinely needed before anyone
  // logs in — the question bank (kept public on request) and staff names for
  // the login picker (never passcodes — see getPublicStaffRoster()). Results,
  // reports, wrong answers, AI results, and all Resources content used to
  // live here too; they now only come back through get_scoped_data(), which
  // requires a session token issued at login and returns only what that
  // specific person/outlet is scoped to see. See issueSessionToken() and
  // handleGetScopedData() below.
  const data = {
    questions: getSheetData(SS.getSheetByName("Questions")), 
    staffRoster: getPublicStaffRoster()
  };
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON); 
}

function isSameCalendarDay(d1, d2) {
  return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate(); 
}

function doPost(e) {
  if (!e || !e.postData) return ContentService.createTextOutput("No data received").setMimeType(ContentService.MimeType.TEXT); 
  
  try {
    const data = JSON.parse(e.postData.contents); 
    const now = new Date(); 
    
    const outletClean = (data.outlet || "Unknown").toString().trim().toUpperCase(); 
    const staffClean = (data.name || data.staffName || "Unknown").toString().trim().toUpperCase(); 
    const topicClean = (data.topic || data.trainTitle || "N/A").toString().trim(); 

    if (data.isPreviewMode) {
      return ContentService.createTextOutput("Preview Success").setMimeType(ContentService.MimeType.TEXT); 
    }

    // v1.14: PIN verification happens here now, server-side, so the actual
    // PIN values never sit in the browser's JavaScript where anyone could
    // read them via View Source.
    if (data.action === 'verify_pin') {
      try {
        return ContentService.createTextOutput(JSON.stringify(handleVerifyPin(data))).setMimeType(ContentService.MimeType.JSON); 
      } catch (err) {
        return ContentService.createTextOutput(JSON.stringify({ authorized: false, error: err.toString() })).setMimeType(ContentService.MimeType.JSON); 
      }
    }

    // v1.21: Staff roster — passcode-based login for Retail and Warehouse
    // staff, managed by Outlet Manager / Warehouse Manager respectively.
    if (data.action === 'verify_staff_login') {
      try {
        return ContentService.createTextOutput(JSON.stringify(handleVerifyStaffLogin(data))).setMimeType(ContentService.MimeType.JSON); 
      } catch (err) {
        return ContentService.createTextOutput(JSON.stringify({ authorized: false, error: err.toString() })).setMimeType(ContentService.MimeType.JSON); 
      }
    }
    if (data.action === 'establish_session') {
      try {
        return ContentService.createTextOutput(JSON.stringify(handleEstablishSession(data))).setMimeType(ContentService.MimeType.JSON); 
      } catch (err) {
        return ContentService.createTextOutput(JSON.stringify({ authorized: false, error: err.toString() })).setMimeType(ContentService.MimeType.JSON); 
      }
    }
    if (data.action === 'get_scoped_data') {
      try {
        return ContentService.createTextOutput(JSON.stringify(handleGetScopedData(data))).setMimeType(ContentService.MimeType.JSON); 
      } catch (err) {
        return ContentService.createTextOutput(JSON.stringify({ authorized: false, error: err.toString() })).setMimeType(ContentService.MimeType.JSON); 
      }
    }
    if (data.action === 'get_staff_roster_full') {
      try {
        return ContentService.createTextOutput(JSON.stringify(handleGetStaffRosterFull(data))).setMimeType(ContentService.MimeType.JSON); 
      } catch (err) {
        return ContentService.createTextOutput(JSON.stringify({ authorized: false, error: err.toString() })).setMimeType(ContentService.MimeType.JSON); 
      }
    }
    if (data.action === 'add_staff') {
      try {
        return ContentService.createTextOutput(JSON.stringify(handleAddStaff(data))).setMimeType(ContentService.MimeType.JSON); 
      } catch (err) {
        return ContentService.createTextOutput(JSON.stringify({ status: 'error', error: err.toString() })).setMimeType(ContentService.MimeType.JSON); 
      }
    }
    if (data.action === 'upload_resource_file') {
      try {
        return ContentService.createTextOutput(JSON.stringify(handleUploadResourceFile(data))).setMimeType(ContentService.MimeType.JSON); 
      } catch (err) {
        return ContentService.createTextOutput(JSON.stringify({ status: 'error', error: err.toString() })).setMimeType(ContentService.MimeType.JSON); 
      }
    }
    if (data.action === 'remove_staff') {
      try {
        return ContentService.createTextOutput(JSON.stringify(handleRemoveStaff(data))).setMimeType(ContentService.MimeType.JSON); 
      } catch (err) {
        return ContentService.createTextOutput(JSON.stringify({ status: 'error', error: err.toString() })).setMimeType(ContentService.MimeType.JSON); 
      }
    }

    // v3.2 / v1.2 ACTIONS: Knowledge Base / Quiz Settings / Outlet Notes / AI Quiz.
    // Handled BEFORE ensureDriveStructure — these aren't staff attempts that need
    // a personnel Drive folder (save_ai_result is the one exception; handled below,
    // after Drive structure, since it IS a staff attempt worth filing).
    if (data.action === 'save_content') return handleSaveContent(data); 
    if (data.action === 'delete_content') return handleDeleteContent(data); 
    if (data.action === 'create_ai_quiz') {
      // Always return JSON here, success or failure — this is the one place a
      // plain-text error (from doPost's outer catch) would silently break the
      // frontend's res.json() call and show a useless generic alert.
      try {
        return ContentService.createTextOutput(JSON.stringify(handleCreateAIQuiz(data))).setMimeType(ContentService.MimeType.JSON); 
      } catch (err) {
        return ContentService.createTextOutput(JSON.stringify({ error: err.toString() })).setMimeType(ContentService.MimeType.JSON); 
      }
    }
    if (data.action === 'get_ai_quiz') {
      try {
        return ContentService.createTextOutput(JSON.stringify(handleGetAIQuiz(data))).setMimeType(ContentService.MimeType.JSON); 
      } catch (err) {
        return ContentService.createTextOutput(JSON.stringify({ error: err.toString() })).setMimeType(ContentService.MimeType.JSON); 
      }
    }
    if (data.action === 'get_outlet_active_quiz') {
      try {
        return ContentService.createTextOutput(JSON.stringify(handleGetOutletActiveQuiz(data))).setMimeType(ContentService.MimeType.JSON); 
      } catch (err) {
        return ContentService.createTextOutput(JSON.stringify({ active: false })).setMimeType(ContentService.MimeType.JSON); 
      }
    }
    if (data.action === 'end_ai_quiz') {
      try {
        return ContentService.createTextOutput(JSON.stringify(handleEndAIQuiz(data))).setMimeType(ContentService.MimeType.JSON); 
      } catch (err) {
        return ContentService.createTextOutput(JSON.stringify({ status: 'error' })).setMimeType(ContentService.MimeType.JSON); 
      }
    }

    ensureDriveStructure(staffClean, outletClean); 

    // ACTION: SAVE QUIZ RESULT (Standard quiz — Matches Index v3.1 Score Hub)
    if (data.action === 'save_result') {
      // v1.26: the token proves this request really came from whoever just
      // logged in as staffClean/outletClean — not just anyone who knows the
      // action name. Without this, a scripted request could submit a fake
      // score under any staff member's name.
      const sr = readSessionToken((data.token || '').toString()); 
      if (!sr || sr.scopeType !== 'staff_retail' || sr.scopeKey !== outletClean + '|' + staffClean) {
        return ContentService.createTextOutput(JSON.stringify({ status: 'unauthorized' })).setMimeType(ContentService.MimeType.JSON); 
      }

      let resSheet = SS.getSheetByName("Results") || SS.insertSheet("Results"); 
      if (resSheet.getLastRow() === 0) resSheet.appendRow(["Timestamp", "Name", "Outlet", "Score", "Percentage", "Topic"]); 

      // v1.12: server-side backstop for the one-attempt-per-day rule. The
      // frontend already blocks a repeat using its own (possibly slightly
      // stale) copy of the data; this re-checks directly against the sheet
      // so a stale client can't slip a duplicate through.
      const alreadyToday = resSheet.getDataRange().getValues().slice(1).some(row =>
        (row[1]||'').toString().trim().toUpperCase() === staffClean &&
        (row[2]||'').toString().trim().toUpperCase() === outletClean &&
        (row[5]||'').toString().trim() === topicClean &&
        isSameCalendarDay(new Date(row[0]), now)
      ); 
      if (alreadyToday) {
        return ContentService.createTextOutput("SUCCESS").setMimeType(ContentService.MimeType.TEXT); 
      }
      
      const nextRow = resSheet.getLastRow() + 1;
      resSheet.getRange(nextRow, 4).setNumberFormat('@'); 
      resSheet.appendRow([now, staffClean, outletClean, data.score.toString(), "'" + data.perc, topicClean]); 
      
      if (data.wrongAnswers && Array.isArray(data.wrongAnswers)) {
        let wrongSheet = SS.getSheetByName("WrongAnswers") || SS.insertSheet("WrongAnswers"); 
        if (wrongSheet.getLastRow() === 0) wrongSheet.appendRow(["Timestamp", "Staff Name", "Outlet", "Topic", "Question Text", "User Choice", "Correct Answer"]); 
        data.wrongAnswers.forEach(item => {
          wrongSheet.appendRow([now, staffClean, outletClean, topicClean, item.qText.toString().trim(), item.userChoice, item.correctText]); 
        });
      }
      applyRetrainingFlags(); 
      return ContentService.createTextOutput("SUCCESS").setMimeType(ContentService.MimeType.TEXT);
    }

    // ACTION: SAVE AI PRACTICE RESULT (v1.2 — ephemeral questions, but the attempt itself
    // is persisted so the Outlet Manager can see scores + wrong answers. Kept in separate
    // sheets from the official Results/WrongAnswers so it never touches AM/Supervisor stats.)
    if (data.action === 'save_ai_result') {
      // v1.26: same identity proof as save_result, accepting either staff
      // scope type since AI Practice is available to both divisions.
      const sar = readSessionToken((data.token || '').toString()); 
      const validScope = sar && (sar.scopeType === 'staff_retail' || sar.scopeType === 'staff_warehouse') && sar.scopeKey === outletClean + '|' + staffClean; 
      if (!validScope) {
        return ContentService.createTextOutput(JSON.stringify({ status: 'unauthorized' })).setMimeType(ContentService.MimeType.JSON); 
      }

      const attemptId = (data.attemptId || ('AI' + now.getTime())).toString(); 
      const passcodeClean = (data.passcode || '').toString().trim(); 

      let aiResSheet = SS.getSheetByName("AIResults") || SS.insertSheet("AIResults"); 
      if (aiResSheet.getLastRow() === 0) aiResSheet.appendRow(["Timestamp", "AttemptID", "Name", "Outlet", "Score", "Percentage", "Topic", "Passcode"]); 

      // v1.12: same same-day backstop, keyed to the passcode (a new code
      // generated later the same day is a genuinely different quiz).
      const alreadyToday = aiResSheet.getDataRange().getValues().slice(1).some(row =>
        (row[2]||'').toString().trim().toUpperCase() === staffClean &&
        (row[3]||'').toString().trim().toUpperCase() === outletClean &&
        (row[7]||'').toString().trim() === passcodeClean &&
        isSameCalendarDay(new Date(row[0]), now)
      ); 
      if (alreadyToday) {
        return ContentService.createTextOutput("SUCCESS").setMimeType(ContentService.MimeType.TEXT); 
      }

      aiResSheet.getRange(aiResSheet.getLastRow() + 1, 5).setNumberFormat('@'); 
      aiResSheet.appendRow([now, attemptId, staffClean, outletClean, data.score.toString(), "'" + data.perc, topicClean, passcodeClean]); 

      if (data.wrongAnswers && Array.isArray(data.wrongAnswers)) {
        let aiWrongSheet = SS.getSheetByName("AIWrongAnswers") || SS.insertSheet("AIWrongAnswers"); 
        if (aiWrongSheet.getLastRow() === 0) aiWrongSheet.appendRow(["Timestamp", "AttemptID", "Staff Name", "Outlet", "Topic", "Question Text", "User Choice", "Correct Answer"]); 
        data.wrongAnswers.forEach(item => {
          aiWrongSheet.appendRow([now, attemptId, staffClean, outletClean, topicClean, item.qText.toString().trim(), item.userChoice, item.correctText]); 
        });
      }
      return ContentService.createTextOutput("SUCCESS").setMimeType(ContentService.MimeType.TEXT);
    }

    // ACTION: SAVE MANAGER REPORT (Area Manager — one report per staff+topic+outlet;
    // v1.13: duplicates are blocked unless data.isEdit is explicitly set, and this
    // now always returns JSON so the frontend can actually react to the result
    // instead of firing-and-forgetting.)
    if (data.action === 'save_report') {
      try {
        let repSheet = SS.getSheetByName("Reports") || SS.insertSheet("Reports"); 
        if (repSheet.getLastRow() === 0) {
          repSheet.appendRow(["Timestamp", "Manager", "Outlet", "Staff Name", "Quiz Score", "Training Title", "Skill Level", "Competency Comments", "Housebrand Focus", "Performance Gaps", "Recommendations", "Fluency", "Product Knowledge", "Communication and Customer Service", "Product Knowledge Comments"]); 
        }

        const reportData = repSheet.getDataRange().getValues(); 
        let existingRowIndex = -1; 
        let existingRow = null; 

        for (let i = 1; i < reportData.length; i++) {
          if (reportData[i][3].toString().toUpperCase().trim() === staffClean && 
              reportData[i][5].toString().trim() === topicClean && 
              reportData[i][2].toString().toUpperCase().trim() === outletClean) {
            existingRowIndex = i + 1; 
            existingRow = reportData[i]; 
            break; 
          }
        }

        if (existingRowIndex > -1 && !data.isEdit) {
          // A report already exists and this wasn't flagged as an intentional
          // edit — block it instead of silently overwriting.
          return ContentService.createTextOutput(JSON.stringify({
            status: 'duplicate', 
            existing: { manager: existingRow[1], timestamp: new Date(existingRow[0]).toISOString() }
          })).setMimeType(ContentService.MimeType.JSON); 
        }

        if (existingRowIndex > -1 && data.isEdit && existingRow[1].toString() !== data.manager) {
          // Editing is fine, but not across a different manager's report.
          return ContentService.createTextOutput(JSON.stringify({ status: 'auth_error' })).setMimeType(ContentService.MimeType.JSON); 
        }

        const reportDate = data.trainingDate ? new Date(data.trainingDate) : now; 
        // v1.29: Competency Comments and Housebrand Focus are no longer
        // collected by the form — left blank for new reports rather than
        // removed from the sheet, so every historical report filed before
        // this change stays exactly as it was, untouched.
        // v1.34: same pattern again — "Fluency" is now labelled "Competency"
        // in the UI but reuses the same numeric column (same meaning, same
        // 0-10 scale, purely a relabel). "Product Knowledge" changed from a
        // 0-10 mark to a free-text comment — rather than repurpose the old
        // numeric column for text, a new "Product Knowledge Comments" column
        // was appended; the old numeric column is left blank going forward
        // but keeps every historical mark exactly as filed. "Communication
        // and Customer Service" is removed from the form the same way the
        // earlier fields were — column stays, simply never written to again.
        const rowValues = [
          reportDate, 
          data.manager, 
          outletClean, 
          staffClean, 
          data.staffScore.toString(), 
          topicClean, 
          data.level, 
          '', 
          '', 
          data.gaps, 
          data.rec, 
          data.competency || '', 
          '', 
          '', 
          data.productKnowledgeComments || ''
        ]; 

        if (existingRowIndex > -1) {
          repSheet.getRange(existingRowIndex, 5).setNumberFormat('@'); 
          repSheet.getRange(existingRowIndex, 1, 1, 15).setValues([rowValues]); 
          return ContentService.createTextOutput(JSON.stringify({ status: 'updated' })).setMimeType(ContentService.MimeType.JSON); 
        } else {
          const nextRepRow = repSheet.getLastRow() + 1; 
          repSheet.getRange(nextRepRow, 5).setNumberFormat('@'); 
          repSheet.appendRow(rowValues); 
          return ContentService.createTextOutput(JSON.stringify({ status: 'created' })).setMimeType(ContentService.MimeType.JSON); 
        }
      } catch (err) {
        return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: err.toString() })).setMimeType(ContentService.MimeType.JSON); 
      }
    }

    return ContentService.createTextOutput("Success").setMimeType(ContentService.MimeType.TEXT); 
  } catch (error) {
    return ContentService.createTextOutput("Error: " + error.toString()).setMimeType(ContentService.MimeType.TEXT); 
  }
}

// ============================================================
// ADMIN TOOLS SECTION
// ============================================================

function onOpen() {
  try {
    const ui = SpreadsheetApp.getUi(); 
    ui.createMenu('🚀 ADMIN FINAL v4') 
        .addItem('1. Manual Entry Wizard', 'adminWizard') 
        .addItem('2. Bulk Import Tool', 'adminBulk') 
        .addSeparator()
        .addItem('3. Sync Headers & Format', 'syncDashboardHeaders') 
        .addItem('4. Refresh Red Flags', 'refreshAllRetrainingFlags') 
        .addSeparator()
        .addItem('5. Archive Old Data (run now)', 'archiveOldData') 
        .addItem('6. Schedule Monthly Archiving', 'installArchiveTrigger') 
        .addToUi(); 
  } catch (e) { Logger.log("UI skipped"); }
}

function syncDashboardHeaders() {
  try {
    const ui = SpreadsheetApp.getUi(); 
    const resSheet = SS.getSheetByName("Results") || SS.insertSheet("Results"); 
    resSheet.getRange(1, 1, 1, 6).setValues([["Timestamp", "Name", "Outlet", "Score", "Percentage", "Topic"]]).setBackground("#0F6B5C").setFontColor("white").setFontWeight("bold"); 
    resSheet.getRange("D:D").setNumberFormat('@'); 

    const wrongSheet = SS.getSheetByName("WrongAnswers") || SS.insertSheet("WrongAnswers"); 
    wrongSheet.getRange(1, 1, 1, 7).setValues([["Timestamp", "Staff Name", "Outlet", "Topic", "Question Text", "User Choice", "Correct Answer"]]).setBackground("#DC2626").setFontColor("white").setFontWeight("bold"); 
    
    const repSheet = SS.getSheetByName("Reports") || SS.insertSheet("Reports"); 
    repSheet.getRange(1, 1, 1, 15).setValues([["Timestamp", "Manager", "Outlet", "Staff Name", "Quiz Score", "Training Title", "Skill Level", "Competency Comments", "Housebrand Focus", "Performance Gaps", "Recommendations", "Fluency", "Product Knowledge", "Communication and Customer Service", "Product Knowledge Comments"]]).setBackground("#16A34A").setFontColor("white").setFontWeight("bold"); 
    repSheet.getRange("E:E").setNumberFormat('@'); 

    // v3.2: Knowledge Base sheet
    const contentSheet = SS.getSheetByName("Content") || SS.insertSheet("Content"); 
    contentSheet.getRange(1, 1, 1, 7).setValues([["ID", "Topic", "Category", "Title", "Body", "Link", "Timestamp"]]).setBackground("#2563EB").setFontColor("white").setFontWeight("bold"); 

    // v3.2: Quiz Length Settings sheet (per Outlet + Topic, set by Area Managers)
    const qSetSheet = SS.getSheetByName("QuizSettings") || SS.insertSheet("QuizSettings"); 
    qSetSheet.getRange(1, 1, 1, 5).setValues([["Outlet", "Topic", "Count", "Manager", "Timestamp"]]).setBackground("#0F6B5C").setFontColor("white").setFontWeight("bold"); 

    // v1.2: Outlet Notes sheet (per Outlet + Topic, set by Outlet Managers)
    const noteSheet = SS.getSheetByName("OutletNotes") || SS.insertSheet("OutletNotes"); 
    noteSheet.getRange(1, 1, 1, 6).setValues([["Outlet", "Topic", "Notes", "Manager", "Timestamp", "SelectedResources"]]).setBackground("#D64026").setFontColor("white").setFontWeight("bold"); 

    // v1.2: AI Practice Results + Wrong Answers sheets
    const aiResSheet = SS.getSheetByName("AIResults") || SS.insertSheet("AIResults"); 
    aiResSheet.getRange(1, 1, 1, 8).setValues([["Timestamp", "AttemptID", "Name", "Outlet", "Score", "Percentage", "Topic", "Passcode"]]).setBackground("#E28413").setFontColor("white").setFontWeight("bold"); 
    aiResSheet.getRange("E:E").setNumberFormat('@'); 

    const aiWrongSheet = SS.getSheetByName("AIWrongAnswers") || SS.insertSheet("AIWrongAnswers"); 
    aiWrongSheet.getRange(1, 1, 1, 8).setValues([["Timestamp", "AttemptID", "Staff Name", "Outlet", "Topic", "Question Text", "User Choice", "Correct Answer"]]).setBackground("#B8690A").setFontColor("white").setFontWeight("bold"); 

    // v1.6: Manager-created AI Practice quizzes — one active passcode-quiz per outlet.
    // Deliberately NOT included in doGet()'s payload: only resolvable via the
    // get_ai_quiz action, which requires knowing the exact Outlet + Passcode.
    const aiQuizSheet = SS.getSheetByName("AIQuizzes") || SS.insertSheet("AIQuizzes"); 
    aiQuizSheet.getRange(1, 1, 1, 7).setValues([["Outlet", "Passcode", "Topic", "Count", "QuestionsJSON", "CreatedBy", "Timestamp"]]).setBackground("#7A1233").setFontColor("white").setFontWeight("bold"); 
    aiQuizSheet.getRange("B:B").setNumberFormat('@'); 

    // v1.21: Staff roster — passcode-based identity for Retail + Warehouse staff
    const rosterSheet = SS.getSheetByName("StaffRoster") || SS.insertSheet("StaffRoster"); 
    rosterSheet.getRange(1, 1, 1, 7).setValues([["Division", "Outlet", "Name", "IDNote", "Passcode", "AddedBy", "Timestamp"]]).setBackground("#0F6B5C").setFontColor("white").setFontWeight("bold"); 
    rosterSheet.getRange("E:E").setNumberFormat('@'); 

    ui.alert("All set — headers and formatting are synced across every tab."); 
  } catch (e) { Logger.log("Sync Error: " + e.toString()); } 
}

function processManualEntry(name, outlet, topic, score, perc, silent = false) {
  ensureDriveStructure(name, outlet); 
  const sheet = SS.getSheetByName("Results") || SS.insertSheet("Results"); 
  const nextRow = sheet.getLastRow() + 1;
  sheet.getRange(nextRow, 4).setNumberFormat('@');
  sheet.appendRow([new Date(), name, outlet, score.toString(), "'" + perc, topic]); 
  refreshAllRetrainingFlags(); 
  if (!silent) SpreadsheetApp.getUi().alert("Saved " + name + "'s result."); 
}

function refreshAllRetrainingFlags() {
  const sheet = SS.getSheetByName("Results"); 
  if (!sheet || sheet.getLastRow() < 2) return; 
  const range = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()); 
  const data = range.getValues(); 
  range.setBackground(null).setFontColor(null); 
  data.forEach((row, i) => {
    let p = parseFloat(row[4].toString().replace('%','')); 
    if (!isNaN(p) && p < 70) sheet.getRange(i+2, 1, 1, sheet.getLastColumn()).setBackground("#fee2e2").setFontColor("#991b1b"); 
  });
}

function applyRetrainingFlags() { refreshAllRetrainingFlags(); }

// v1.35: rewritten for scale. The original appended and deleted ONE ROW AT A
// TIME inside a loop — each call being a separate Sheets operation. That is
// slow enough that on a sheet large enough to actually need archiving, it
// risked hitting the 6-minute execution ceiling and dying partway through,
// which is precisely the situation it exists to prevent.
//
// This version reads once, partitions in memory, writes the archive in a
// single batch, and rewrites the source sheet in one operation.
//
// Retention is configurable via the ARCHIVE_AFTER_DAYS script property
// (default 365). The old 30-day default was far too aggressive for a training
// app where a year-on-year view is genuinely useful.
function archiveOldData() {
  const props = PropertiesService.getScriptProperties(); 
  const days = parseInt(props.getProperty('ARCHIVE_AFTER_DAYS')) || 365; 
  const thresholdDate = new Date(); 
  thresholdDate.setDate(thresholdDate.getDate() - days); 

  const configs = [
    { source: "Results", archive: "Archive_Results" }, 
    { source: "Reports", archive: "Archive_Reports" }
  ]; 
  const summary = []; 

  configs.forEach(config => {
    const src = SS.getSheetByName(config.source); 
    if (!src) return; 
    const data = src.getDataRange().getValues(); 
    if (data.length < 2) return; 

    const header = data[0]; 
    const keep = []; 
    const move = []; 
    for (let i = 1; i < data.length; i++) {
      const d = new Date(data[i][0]); 
      // Unparseable dates are KEPT, never archived — losing a row to a
      // malformed timestamp would be worse than leaving it in place.
      if (!isNaN(d.getTime()) && d < thresholdDate) move.push(data[i]); 
      else keep.push(data[i]); 
    }
    if (!move.length) { summary.push(config.source + ': nothing to archive'); return; } 

    const arc = SS.getSheetByName(config.archive) || SS.insertSheet(config.archive); 
    if (arc.getLastRow() === 0) arc.appendRow(header); 
    // One batch write instead of N appends
    arc.getRange(arc.getLastRow() + 1, 1, move.length, header.length).setValues(move); 

    // Rewrite the source in one operation instead of N deleteRow calls
    src.clearContents(); 
    src.getRange(1, 1, 1, header.length).setValues([header]); 
    if (keep.length) src.getRange(2, 1, keep.length, header.length).setValues(keep); 

    summary.push(config.source + ': archived ' + move.length + ', kept ' + keep.length); 
  });

  Logger.log('archiveOldData — ' + summary.join(' | ')); 
  return summary.join('\n'); 
}

// Run once from the Apps Script editor to schedule monthly archiving. Safe to
// re-run: it clears any existing archive trigger first so you never end up
// with duplicates silently stacking up.
function installArchiveTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'archiveOldData') ScriptApp.deleteTrigger(t); 
  });
  ScriptApp.newTrigger('archiveOldData').timeBased().onMonthDay(1).atHour(3).create(); 
  return 'Monthly archiving scheduled for the 1st of each month, ~3am.'; 
}

function ensureDriveStructure(name, outlet) {
  if (!PARENT_FOLDER_ID || PARENT_FOLDER_ID.indexOf("PASTE_YOUR") === 0) { Logger.log("PARENT_FOLDER_ID not set yet — skipping Drive folder creation."); return; }
  try {
    const rootFolder = DriveApp.getFolderById(PARENT_FOLDER_ID); 
    const now = new Date(); 
    const yearFolder = getOrCreateFolder(rootFolder, now.getFullYear().toString()); 
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]; 
    const monthFolder = getOrCreateFolder(yearFolder, monthNames[now.getMonth()]); 
    const outletFolder = getOrCreateFolder(monthFolder, outlet); 
    getOrCreateFolder(outletFolder, name); 
  } catch(e) { Logger.log("Drive Sync Terminated."); }
}

function getOrCreateFolder(parent, folderName) {
  const name = (folderName && folderName !== "undefined") ? folderName.toString() : "Unknown"; 
  const folders = parent.getFoldersByName(name); 
  return folders.hasNext() ? folders.next() : parent.createFolder(name); 
}

function getSheetData(sheet) {
  if (!sheet) return []; 
  const rows = sheet.getDataRange().getValues(); 
  if (rows.length < 2) return []; 
  const headers = rows.shift().map(h => h.toString().trim()); 
  return rows.map(row => {
    const obj = {}; 
    headers.forEach((h, i) => {
      let val = row[i]; 
      if (typeof val === 'number' && h.toLowerCase().includes('percentage')) val = (val * 100).toFixed(0) + "%"; 
      if (typeof val === 'string') val = val.trim(); 
      if (h.toLowerCase() === 'score' || h.toLowerCase() === 'quiz score') {
         if (val instanceof Date) {
           val = val.getDate() + "/" + (val.getMonth() + 1);
         } else {
           val = (val || "").toString();
         }
      }
      obj[h] = (val instanceof Date) ? val.toISOString() : val; 
    });
    return obj; 
  });
}

// ============================================================
// v3.2 ADDITIONS: KNOWLEDGE BASE + QUIZ SETTINGS
// ============================================================

function handleSaveContent(data) {
  const check = checkPinInternal('supervisor', (data.pin || '').toString()); 
  if (!check.ok) return ContentService.createTextOutput(JSON.stringify({ status: 'unauthorized', error: check.error || 'Incorrect password.' })).setMimeType(ContentService.MimeType.JSON); 

  let sheet = SS.getSheetByName("Content") || SS.insertSheet("Content"); 
  if (sheet.getLastRow() === 0) sheet.appendRow(["ID", "Topic", "Category", "Title", "Body", "Link", "Timestamp"]); 
  const id = 'C' + new Date().getTime(); 
  sheet.appendRow([id, data.topic, data.category, data.title, data.body, data.link || '', new Date()]); 
  return ContentService.createTextOutput(JSON.stringify({ status: 'ok', id: id })).setMimeType(ContentService.MimeType.JSON); 
}

function handleDeleteContent(data) {
  const check = checkPinInternal('supervisor', (data.pin || '').toString()); 
  if (!check.ok) return ContentService.createTextOutput(JSON.stringify({ status: 'unauthorized', error: check.error || 'Incorrect password.' })).setMimeType(ContentService.MimeType.JSON); 

  const sheet = SS.getSheetByName("Content"); 
  if (sheet) {
    const rows = sheet.getDataRange().getValues(); 
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] === data.id) { sheet.deleteRow(i + 1); break; } 
    }
  }
  return ContentService.createTextOutput(JSON.stringify({ status: 'ok' })).setMimeType(ContentService.MimeType.JSON); 
}

// ============================================================
// v1.2 ADDITIONS: AI QUIZ (GEMINI)
// ------------------------------------------------------------
// One-time setup:
//   1. Run "🚀 ADMIN FINAL v4" → "3. Sync Headers & Format" once to
//      create/format Content, AIResults, AIWrongAnswers tabs.
//   2. Project Settings → Script Properties → add:
//        GEMINI_API_KEY = <your key from https://aistudio.google.com/apikey>
//        GEMINI_MODEL   = (optional, defaults to gemini-3.1-flash-lite)
// ============================================================

function callGemini(prompt) {
  const props = PropertiesService.getScriptProperties(); 
  const apiKey = props.getProperty('GEMINI_API_KEY'); 
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set in Script Properties.'); 
  // v1.7: gemini-2.5-flash has been reported returning "model no longer available"
  // ahead of its official Oct 2026 shutdown date. Defaulting to a current-generation
  // model instead. Override anytime via the GEMINI_MODEL script property.
  const model = props.getProperty('GEMINI_MODEL') || 'gemini-3.1-flash-lite'; 
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + apiKey; 

  const payload = {
    contents: [{ parts: [{ text: prompt }] }], 
    generationConfig: {
      temperature: 0.6, 
      responseMimeType: 'application/json', 
      maxOutputTokens: 8192, 
      // v1.30: responseMimeType alone only asks Gemini for JSON — it doesn't
      // strictly constrain the shape at the token level, so occasionally
      // (more often at high temperature) the model would append stray
      // content after a technically-complete JSON array, breaking JSON.parse
      // with "Unexpected non-whitespace character after JSON". A schema
      // constrains generation itself, not just the response's content type —
      // this is the real fix; the parsing hardening below is a safety net on
      // top of it, not a replacement for it. Temperature also dropped from
      // 0.9 — quiz question phrasing doesn't need that much creative range,
      // and lower temperature further reduces structurally erratic output.
      responseSchema: {
        type: 'ARRAY', 
        items: {
          type: 'OBJECT', 
          properties: {
            question_en: { type: 'STRING' }, question_ms: { type: 'STRING' }, 
            opt1_en: { type: 'STRING' }, opt1_ms: { type: 'STRING' }, 
            opt2_en: { type: 'STRING' }, opt2_ms: { type: 'STRING' }, 
            opt3_en: { type: 'STRING' }, opt3_ms: { type: 'STRING' }, 
            opt4_en: { type: 'STRING' }, opt4_ms: { type: 'STRING' }, 
            correct: { type: 'INTEGER' }
          }, 
          required: ['question_en', 'question_ms', 'opt1_en', 'opt1_ms', 'opt2_en', 'opt2_ms', 'opt3_en', 'opt3_ms', 'opt4_en', 'opt4_ms', 'correct']
        }
      }
    }
  }; 

  const res = UrlFetchApp.fetch(url, {
    method: 'post', 
    contentType: 'application/json', 
    payload: JSON.stringify(payload), 
    muteHttpExceptions: true 
  }); 

  const code = res.getResponseCode(); 
  const bodyText = res.getContentText(); 

  if (code !== 200) {
    // Surface the real cause: bad key, wrong model name, quota, etc. — instead
    // of a generic "failed" message that hides what actually went wrong.
    let reason = bodyText.slice(0, 300); 
    try {
      const errJson = JSON.parse(bodyText); 
      if (errJson.error && errJson.error.message) reason = errJson.error.message; 
    } catch (e) { /* body wasn't JSON — keep the raw snippet */ }
    throw new Error('Gemini API error (HTTP ' + code + ', model "' + model + '"): ' + reason); 
  }

  const json = JSON.parse(bodyText); 
  if (!json.candidates || !json.candidates.length) {
    const blockReason = json.promptFeedback && json.promptFeedback.blockReason; 
    throw new Error(blockReason ? 'Gemini blocked this prompt: ' + blockReason : 'Gemini returned no candidates: ' + bodyText.slice(0, 300)); 
  }

  const candidate = json.candidates[0]; 
  const parts = candidate.content && candidate.content.parts; 
  if (!parts || !parts.length || !parts[0].text) {
    throw new Error('Gemini returned an empty response (finishReason: ' + (candidate.finishReason || 'unknown') + '). Try again, or reduce the question count.'); 
  }
  return parts[0].text; 
}

function extractSlidesText(id) {
  try {
    const pres = SlidesApp.openById(id); 
    let text = ''; 
    pres.getSlides().forEach(slide => {
      slide.getShapes().forEach(shape => {
        try {
          const t = shape.getText && shape.getText().asString(); 
          if (t) text += t + '\n'; 
        } catch (e) { /* shape has no text — skip it */ }
      }); 
      try {
        const notesShape = slide.getNotesPage().getSpeakerNotesShape(); 
        if (notesShape) text += notesShape.getText().asString() + '\n'; 
      } catch (e) { /* no speaker notes — skip */ }
    }); 
    return text; 
  } catch (e) {
    return ''; 
  }
}

function getResourceText(id) {
  // Try Content sheet first (manually-typed Knowledge Base entries)
  const contentRows = getSheetData(SS.getSheetByName("Content")); 
  const match = contentRows.find(r => r.ID === id); 
  if (match) return '# ' + match.Title + '\n' + match.Body; 

  // Otherwise try a Drive file (auto-discovered reference doc) — Drive file IDs
  // are globally unique, so no need to know which folder it's in.
  try {
    const file = DriveApp.getFileById(id); 
    const mime = file.getMimeType(); 

    if (mime === MimeType.GOOGLE_DOCS) {
      const text = DocumentApp.openById(id).getBody().getText(); 
      return '# ' + file.getName() + '\n' + text.slice(0, 6000); 
    }

    if (mime === MimeType.GOOGLE_SLIDES) {
      const text = extractSlidesText(id); 
      if (text) return '# ' + file.getName() + '\n' + text.slice(0, 6000); 
    }

    // v1.11: PDFs and raw .pptx/.docx (never converted to native Google format)
    // can be read too, IF the Drive API advanced service is enabled — this is
    // optional. If it's not enabled, convertViaDriveApi() fails silently and
    // we fall through to the name-only reference below, exactly as before.
    const OFFICE_MIMES = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ]; 
    if (OFFICE_MIMES.indexOf(mime) > -1) {
      const text = convertViaDriveApi(id, mime); 
      if (text) return '# ' + file.getName() + '\n' + text.slice(0, 6000); 
    }

    return '# ' + file.getName() + ' (supplementary file — general best practice applies; full text unavailable for this file type)'; 
  } catch (e) {
    return ''; 
  }
}

// Optional: only works if you've enabled the "Drive API" advanced service in
// this Apps Script project (Editor → Services (+) → Drive API → Add). No code
// changes needed after enabling it — this activates automatically. Skipped
// silently otherwise. PDFs get OCR'd; .docx/.pptx get Google's native
// converter (more reliable than OCR since they're already text, not images).
function convertViaDriveApi(id, mimeType) {
  try {
    const blob = DriveApp.getFileById(id).getBlob(); 
    const isPdf = mimeType === 'application/pdf'; 
    const isPptx = mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation'; 
    const targetMime = isPptx ? MimeType.GOOGLE_SLIDES : MimeType.GOOGLE_DOCS; 
    const resource = { title: 'TEMP_CONVERT_' + new Date().getTime(), mimeType: targetMime }; 
    const options = isPdf ? { convert: true, ocr: true, ocrLanguage: 'en' } : { convert: true }; 

    const converted = Drive.Files.insert(resource, blob, options); 
    const text = (targetMime === MimeType.GOOGLE_SLIDES) 
      ? extractSlidesText(converted.id) 
      : DocumentApp.openById(converted.id).getBody().getText(); 
    DriveApp.getFileById(converted.id).setTrashed(true); 
    return text; 
  } catch (e) {
    Logger.log('PDF/Office conversion skipped (Drive API advanced service likely not enabled): ' + e.toString()); 
    return ''; 
  }
}

function buildQuizPrompt(topicLabel, context, count, extraNotes) {
  return 'You are creating a bilingual (English + Bahasa Malaysia) multiple-choice training quiz for retail pharmacy staff in Malaysia.\n' + 
    'Topic: "' + topicLabel + '"\n' + 
    'Reference material:\n"""\n' + context + '\n"""\n\n' + 
    (extraNotes ? 'The manager creating this quiz has asked that questions especially emphasize:\n"""\n' + extraNotes + '\n"""\n\n' : '') + 
    'Generate exactly ' + count + ' multiple-choice questions that test understanding of the ' + 
    'reference material above (or general best practice if the material is thin), giving extra ' + 
    'weight to the manager\'s emphasis if provided. Each question must have exactly 4 ' + 
    'options with exactly ONE correct answer. Vary which option index is correct across questions. ' + 
    'Keep each question concise and unambiguous. You MUST provide both an English version and a ' + 
    'natural, accurate Bahasa Malaysia translation for every question and every option — never leave ' + 
    'the _ms fields blank or identical placeholders.\n\n' + 
    'Return ONLY valid JSON — no markdown fences, no commentary — matching exactly this schema:\n' + 
    '[{"question_en":"...","question_ms":"...","opt1_en":"...","opt1_ms":"...","opt2_en":"...","opt2_ms":"...","opt3_en":"...","opt3_ms":"...","opt4_en":"...","opt4_ms":"...","correct":0}]\n' + 
    '"correct" is the zero-based index (0-3) of the correct option.'; 
}

function generatePasscode() {
  return ('000' + Math.floor(Math.random() * 1000)).slice(-3); 
}

// Finds the outermost [...] array in a text response, tracking whether we're
// inside a quoted string (and escape sequences within it) so a stray "]" or
// "[" sitting inside a question/option's text can't fool the bracket count
// the way a plain regex could. Returns the substring, or null if the
// brackets never balance (e.g. the response was genuinely truncated).
function extractJsonArray(text) {
  const start = text.indexOf('['); 
  if (start === -1) return null; 
  let depth = 0, inString = false, escaped = false; 
  for (let i = start; i < text.length; i++) {
    const ch = text[i]; 
    if (inString) {
      if (escaped) { escaped = false; } 
      else if (ch === '\\') { escaped = true; } 
      else if (ch === '"') { inString = false; } 
      continue; 
    }
    if (ch === '"') { inString = true; continue; } 
    if (ch === '[') depth++; 
    else if (ch === ']') {
      depth--; 
      if (depth === 0) return text.slice(start, i + 1); 
    }
  }
  return null; // never balanced — likely a genuinely truncated response
}

// Manager-triggered: generate a quiz ONCE, store it, and hand back a 3-digit
// passcode scoped to that outlet. One active quiz per outlet — creating a new
// one overwrites the previous row, retiring the old code.
function handleCreateAIQuiz(data) {
  const outlet = (data.outlet || '').toString().trim().toUpperCase(); 

  // v1.26: same manager-session proof as handleEndAIQuiz.
  const cSession = readSessionToken((data.token || '').toString()); 
  const cValidScope = cSession && (cSession.scopeType === 'outlet_manager' || cSession.scopeType === 'warehouse_manager') && cSession.scopeKey === outlet; 
  if (!cValidScope) return { error: 'Your session has expired — please log in again.' }; 

  const sourceType = (data.sourceType || 'topic').toString(); 
  const sourceValue = (data.sourceValue || '').toString().trim(); 
  const topicLabel = (data.topicLabel || sourceValue || 'General').toString().trim(); 
  const count = Math.min(Math.max(parseInt(data.count) || 10, 1), 25); 
  const extraNotes = (data.extraNotes || '').toString().trim(); 

  let context = ''; 
  if (sourceType === 'resource') {
    context = getResourceText(sourceValue); 
  } else {
    const contentRows = getSheetData(SS.getSheetByName("Content")).filter(r => (r.Topic || "").toString().trim() === sourceValue); 
    context = contentRows.map(r => '# ' + r.Title + '\n' + r.Body).join('\n\n'); 
  }
  context = (context || '').slice(0, 8000); 
  if (!context) {
    context = 'No specific reference material has been uploaded for "' + topicLabel + '" yet. ' + 
              'Use general best-practice retail pharmacy knowledge for this topic instead.'; 
  }

  // The Gemini call is the slow part (network round-trip) — deliberately done
  // BEFORE taking the lock below, so one outlet generating a quiz never makes
  // another outlet's manager wait on it.
  const prompt = buildQuizPrompt(topicLabel, context, count, extraNotes); 
  const raw = callGemini(prompt); 

  let questions; 
  try {
    questions = JSON.parse(raw); 
  } catch (e) {
    // v1.30: a naive greedy regex here could itself grab a malformed
    // substring and throw its own confusing SyntaxError with nothing logged
    // to diagnose it. extractJsonArray properly tracks string/escape state,
    // so it won't be fooled by a stray bracket sitting inside a quoted
    // question or option — and if it still can't find valid JSON, the raw
    // response gets logged so this is actually debuggable next time.
    const extracted = extractJsonArray(raw); 
    try {
      questions = extracted ? JSON.parse(extracted) : null; 
    } catch (e2) {
      questions = null; 
    }
    if (!questions) {
      Logger.log('AI quiz generation: could not parse Gemini response. First 2000 chars: ' + raw.slice(0, 2000)); 
      throw new Error('Gemini returned a response that could not be read as a quiz. Please try again — if this keeps happening, try a smaller question count.'); 
    }
  }
  if (!questions || !questions.length) throw new Error('Gemini did not return any usable questions. Please try again.'); 
  questions.forEach(q => { q.topic = topicLabel; }); 

  // v1.8: LockService serializes the sheet read-modify-write below so two
  // managers generating quizzes at the same instant (same outlet or
  // different outlets) can't race each other and corrupt AIQuizzes.
  const lock = LockService.getScriptLock(); 
  if (!lock.tryLock(15000)) {
    throw new Error('The system is busy creating another quiz right now. Please try again in a few seconds.'); 
  }

  try {
    let sheet = SS.getSheetByName("AIQuizzes") || SS.insertSheet("AIQuizzes"); 
    if (sheet.getLastRow() === 0) sheet.appendRow(["Outlet", "Passcode", "Topic", "Count", "QuestionsJSON", "CreatedBy", "Timestamp"]); 

    const rows = sheet.getDataRange().getValues(); 
    const oneHourAgo = Date.now() - (60 * 60 * 1000); 
    const activeCodes = {}; 
    let existingRow = -1; 

    for (let i = 1; i < rows.length; i++) {
      const rOutlet = (rows[i][0] || '').toString().trim().toUpperCase(); 
      const rCode = (rows[i][1] || '').toString().trim(); 
      const rTime = new Date(rows[i][6]).getTime(); 
      if (rOutlet === outlet) existingRow = i + 1; 
      // Only codes still inside their 1-hour window count toward uniqueness —
      // an expired code's number is free to be reused by any outlet.
      if (rCode && rTime > oneHourAgo) activeCodes[rCode] = true; 
    }

    // Codes are guaranteed unique across ALL outlets while active — this
    // means a staff member who accidentally picks the wrong outlet can never
    // coincidentally land on a real (but different outlet's) quiz.
    let passcode = generatePasscode(); 
    let attempts = 0; 
    while (activeCodes[passcode] && attempts < 30) { passcode = generatePasscode(); attempts++; } 

    const now = new Date(); 
    // Leading apostrophe forces Sheets to keep the passcode as text (preserves "042" etc.)
    const rowValues = [outlet, "'" + passcode, topicLabel, questions.length, JSON.stringify(questions), data.manager || '', now]; 
    if (existingRow > -1) sheet.getRange(existingRow, 1, 1, 7).setValues([rowValues]); 
    else sheet.appendRow(rowValues); 

    return { passcode: passcode, count: questions.length, topic: topicLabel, expiresInMinutes: 60, createdAt: now.toISOString() }; 
  } finally {
    lock.releaseLock(); 
  }
}

// Staff-triggered: resolve an outlet + passcode to the stored question set.
// Deliberately not part of doGet() — this is the one thing that actually
// gates access, so it only ever returns data for an exact outlet+code match.
function handleGetAIQuiz(data) {
  const outlet = (data.outlet || '').toString().trim().toUpperCase(); 
  const passcode = (data.passcode || '').toString().trim(); 
  const sheet = SS.getSheetByName("AIQuizzes"); 
  if (!sheet) return { error: 'No active quiz found for this outlet.' }; 

  const rows = getSheetData(sheet); 
  const match = rows.find(r => (r.Outlet || '').toString().trim().toUpperCase() === outlet && (r.Passcode || '').toString().trim() === passcode); 
  if (!match) return { error: 'Invalid code for this outlet.' }; 

  const ageMs = Date.now() - new Date(match.Timestamp).getTime(); 
  if (ageMs > 60 * 60 * 1000) {
    return { error: 'This code expired (codes last 1 hour). Ask your outlet manager for a fresh one.' }; 
  }

  let questions = []; 
  try { questions = JSON.parse(match.QuestionsJSON); } catch (e) { return { error: 'Quiz data corrupted — ask your manager to regenerate.' }; } 
  return { topic: match.Topic, questions: questions, passcode: passcode }; 
}

// Outlet Manager dashboard calls this on load (and after generating) so the
// current code + timer survive logging out and back in, or just navigating
// away. Scoped to one outlet, no passcode needed — the dashboard itself is
// already outlet-scoped, so this doesn't reveal anything a manager couldn't
// already get by generating a fresh quiz for that same outlet.
function handleGetOutletActiveQuiz(data) {
  const outlet = (data.outlet || '').toString().trim().toUpperCase(); 
  const sheet = SS.getSheetByName("AIQuizzes"); 
  if (!sheet) return { active: false }; 

  const rows = getSheetData(sheet); 
  const match = rows.find(r => (r.Outlet || '').toString().trim().toUpperCase() === outlet); 
  if (!match) return { active: false }; 

  const createdAt = new Date(match.Timestamp); 
  const ageMs = Date.now() - createdAt.getTime(); 
  if (ageMs > 60 * 60 * 1000) return { active: false }; 

  return { active: true, passcode: (match.Passcode || '').toString(), topic: match.Topic, count: match.Count, createdAt: createdAt.toISOString() }; 
}

// Manager taps "End This Code Now" — deletes the outlet's row outright so the
// code stops resolving immediately, rather than waiting out the 1-hour expiry.
function handleEndAIQuiz(data) {
  const outlet = (data.outlet || '').toString().trim().toUpperCase(); 

  // v1.26: proves this came from a manager who actually established a
  // session scoped to THIS outlet — without this, anyone knowing the action
  // name could end any outlet's active code with no login at all.
  const session = readSessionToken((data.token || '').toString()); 
  const validScope = session && (session.scopeType === 'outlet_manager' || session.scopeType === 'warehouse_manager') && session.scopeKey === outlet; 
  if (!validScope) return { status: 'unauthorized' }; 

  const sheet = SS.getSheetByName("AIQuizzes"); 
  if (!sheet) return { status: 'ok' }; 

  const lock = LockService.getScriptLock(); 
  if (!lock.tryLock(10000)) return { status: 'busy' }; 
  try {
    const rows = sheet.getDataRange().getValues(); 
    for (let i = 1; i < rows.length; i++) {
      if ((rows[i][0] || '').toString().trim().toUpperCase() === outlet) { sheet.deleteRow(i + 1); break; } 
    }
    return { status: 'ended' }; 
  } finally {
    lock.releaseLock(); 
  }
}

// ============================================================
// v1.5 ADDITION: REFERENCE DOCS AUTO-DISCOVERY (BY SECTION)
// ------------------------------------------------------------
// REFERENCE_FOLDER_ID is now a PARENT folder. Inside it, create up to
// five subfolders named exactly:
//   "101 Guide to Retailing", "Housebrand Modules", "General Policies",
//   "Warehousing Handbook", "eLearning Courses"
// Everything inside a named subfolder is tagged with that section and
// shows up merged alongside manually-typed Knowledge Base entries of
// the same category. Anything dropped loose in the parent folder (or
// in a subfolder with some other name) lands in "Halal Certificate",
// the catch-all bucket.
// Each file is set to "Anyone with the link can view" so the in-app
// preview works without a Google login — if your Workspace has a
// restricted-sharing policy this call may silently fail; the file is
// still listed, it just won't preview until shared manually.
// ============================================================

// v1.17: renamed to match actual business terminology. Rename your Drive
// subfolders to match these exactly (case-insensitive) — anything that
// doesn't match one of the five named ones falls into "Halal Certificate",
// which is now the catch-all bucket (was "Reference Documents").
function categorizeFolderName(name) {
  const n = (name || '').trim().toLowerCase(); 
  if (n === '101 guide to retailing') return '101 Guide to Retailing'; 
  if (n === 'housebrand modules') return 'Housebrand Modules'; 
  if (n === 'general policies') return 'General Policies'; 
  if (n === 'warehousing handbook') return 'Warehousing Handbook'; 
  if (n === 'elearning courses') return 'eLearning Courses'; 
  if (n === 'halal certificate') return 'Halal Certificate'; 
  // Anything else (including files dropped loose in the parent folder) also
  // lands here — Halal Certificate doubles as both its own named folder and
  // the catch-all bucket for anything uncategorized.
  return 'Halal Certificate'; 
}

function fileToRefDoc(file, category) {
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) { /* domain policy may block this — file still gets listed */ }

  // v1.22: download restored on request — this reverses the v1.16 block on
  // download/print/copy. Worth knowing: this means anyone who gets hold of a
  // file's link (not just people who go through the app) can download it.
  // The app-level gate (category PIN, staff roster) still controls who
  // reaches the Resources page in the first place, but once a link is out,
  // Drive's own permissions no longer add a second layer on top of that.

  const mime = file.getMimeType(); 
  const id = file.getId(); 
  let kind = 'File', downloadUrl = 'https://drive.google.com/uc?export=download&id=' + id; 

  if (mime === MimeType.GOOGLE_DOCS) { kind = 'Doc'; downloadUrl = 'https://docs.google.com/document/d/' + id + '/export?format=pdf'; }
  else if (mime === MimeType.GOOGLE_SLIDES) { kind = 'Slides'; downloadUrl = 'https://docs.google.com/presentation/d/' + id + '/export/pdf'; }
  else if (mime === MimeType.GOOGLE_SHEETS) { kind = 'Sheet'; downloadUrl = 'https://docs.google.com/spreadsheets/d/' + id + '/export?format=pdf'; }
  else if (mime === MimeType.PDF) { kind = 'PDF'; }

  return {
    ID: id, 
    Name: file.getName(), 
    Kind: kind, 
    Category: category, 
    PreviewURL: 'https://drive.google.com/file/d/' + id + '/preview', 
    DownloadURL: downloadUrl, 
    Updated: file.getLastUpdated().toISOString()
  }; 
}

// Walks a folder and every folder nested inside it, at any depth, tagging
// every file found along the way with the same category. Drive folders
// can't form cycles through normal use, so no cycle guard needed here.
// v1.23: each file/subfolder is now wrapped individually — previously, one
// bad file (a permissions quirk, a corrupted reference, anything throwing)
// would abort the whole walk via the uncaught exception, silently wiping out
// every OTHER file already found, including ones from folders that were
// working fine. That could look exactly like "subfolders don't work" when
// the real cause was one unrelated file elsewhere failing.
function collectFilesRecursive(folder, category, docs, stats) {
  try {
    const files = folder.getFiles(); 
    while (files.hasNext()) {
      try {
        docs.push(fileToRefDoc(files.next(), category)); 
        stats.filesFound++; 
      } catch (e) {
        stats.fileErrors++; 
        Logger.log('Skipped a file under "' + category + '": ' + e.toString()); 
      }
    }
  } catch (e) {
    stats.folderErrors++; 
    Logger.log('Could not list files in a folder under "' + category + '": ' + e.toString()); 
  }

  try {
    const subfolders = folder.getFolders(); 
    while (subfolders.hasNext()) {
      stats.foldersVisited++; 
      collectFilesRecursive(subfolders.next(), category, docs, stats); 
    }
  } catch (e) {
    stats.folderErrors++; 
    Logger.log('Could not list subfolders under "' + category + '": ' + e.toString()); 
  }
}

function getReferenceDocs() {
  if (!REFERENCE_FOLDER_ID || REFERENCE_FOLDER_ID.indexOf("PASTE_YOUR") === 0) return []; 
  const parent = DriveApp.getFolderById(REFERENCE_FOLDER_ID); 
  const docs = []; 
  const stats = { foldersVisited: 1, filesFound: 0, fileErrors: 0, folderErrors: 0 }; 

  // Files dropped loose in the parent folder → the catch-all bucket
  try {
    const looseFiles = parent.getFiles(); 
    while (looseFiles.hasNext()) {
      try {
        docs.push(fileToRefDoc(looseFiles.next(), 'Halal Certificate')); 
        stats.filesFound++; 
      } catch (e) {
        stats.fileErrors++; 
        Logger.log('Skipped a loose file: ' + e.toString()); 
      }
    }
  } catch (e) {
    Logger.log('Could not list loose files in the parent folder: ' + e.toString()); 
  }

  // Each named subfolder → its matching section — walked recursively, so
  // whatever structure someone builds inside (sub-subfolders, folders inside
  // those, any depth) still gets discovered and tagged with the same
  // top-level category as the subfolder it lives under.
  try {
    const subfolders = parent.getFolders(); 
    while (subfolders.hasNext()) {
      const sub = subfolders.next(); 
      stats.foldersVisited++; 
      const category = categorizeFolderName(sub.getName()); 
      collectFilesRecursive(sub, category, docs, stats); 
    }
  } catch (e) {
    Logger.log('Could not list subfolders in the parent folder: ' + e.toString()); 
  }

  // v1.28: breakdown by category — this is what actually answers "the count
  // is right, so why can't I see it" — a file landing in a category that
  // doesn't match any of the six section headers is invisible in the list
  // even though it was correctly found and counted. Most common cause: the
  // folder holding it is a SIBLING of the six named category folders, not
  // truly nested INSIDE one of them — everything in a sibling folder (any
  // name) falls into Halal Certificate, the catch-all, not wherever its name
  // might suggest it should go.
  const byCategory = {}; 
  docs.forEach(d => { byCategory[d.Category] = (byCategory[d.Category] || 0) + 1; }); 
  stats.byCategory = byCategory; 

  // Check Apps Script → View → Executions (or Logger) to see this after any
  // sync — confirms exactly how many folders were walked and files found,
  // regardless of whether the app's own display looks right or not.
  Logger.log('getReferenceDocs: ' + JSON.stringify(stats)); 
  lastResourceSyncStats = stats; 

  return docs; 
}

// ============================================================
// v1.14 ADDITION: SERVER-SIDE PIN VERIFICATION
// ------------------------------------------------------------
// PINs used to be hardcoded directly in index.html's JavaScript, readable by
// anyone via View Source. Now the frontend just asks "is this PIN right?"
// and gets back true/false — the actual value never reaches the browser.
//
// Optional (recommended) setup: Project Settings → Script Properties → add
// any of these to override the defaults below:
//   AREA_MANAGER_PIN     (default if unset: 1234)
//   OUTLET_MANAGER_PIN   (default if unset: 1234)
//   SUPERVISOR_PIN       (default if unset: SV2026)
// Skipping this is fine — the app keeps working with the same PINs as
// before, just no longer exposed in the page source. Setting your own
// values here is what actually makes them harder to guess.
//
// Basic brute-force protection: 5 wrong PINs for a given role within 5
// minutes locks out further attempts for that role until the window
// expires. Worth knowing: because these PINs are shared per-role (not
// per-person), this also means someone could deliberately lock out real
// managers by submitting wrong PINs on purpose. For an internal training
// tool this trade-off is reasonable, but it's not a bulletproof mechanism —
// see the Cloudflare Access option in the deployment guide for a stronger,
// still-free layer if that risk matters to you.
// ============================================================

// ============================================================
// v1.26 ADDITION: SESSION TOKENS (gated + scoped data access)
// ------------------------------------------------------------
// Issued once, right when an identity is actually established (staff roster
// login; an Outlet/Warehouse Manager picking their outlet or location; an
// Area Manager picking their name+outlet; Supervisor's password). Every
// later data request and several write actions now carry this token instead
// of re-sending credentials — a cheap CacheService lookup instead of a full
// re-verification, and the actual passcode/PIN travels the network less.
// Tokens expire after 4 hours; there's no logout button that clears them
// early, so this is the practical session length everywhere in the app.
// ============================================================

const SESSION_TTL_SECONDS = 4 * 60 * 60; // 4 hours — CacheService's own ceiling is 6

function issueSessionToken(scopeType, scopeKey) {
  const token = Utilities.getUuid(); 
  const cache = CacheService.getScriptCache(); 
  cache.put('session_' + token, JSON.stringify({ scopeType: scopeType, scopeKey: scopeKey, issuedAt: Date.now() }), SESSION_TTL_SECONDS); 
  return token; 
}

function readSessionToken(token) {
  if (!token) return null; 
  const cache = CacheService.getScriptCache(); 
  const raw = cache.get('session_' + token); 
  if (!raw) return null; 
  try { return JSON.parse(raw); } catch (e) { return null; } 
}

// Staff/Warehouse Staff identity is already fully proven by
// handleVerifyStaffLogin — this just also issues the token in that same call.
function handleVerifyStaffLogin(data) {
  const division = (data.division || '').toString().trim().toLowerCase(); 
  const outlet = (data.outlet || '').toString().trim().toUpperCase(); 
  const name = (data.name || '').toString().trim().toUpperCase(); 
  const passcode = (data.passcode || '').toString().trim(); 

  const cache = CacheService.getScriptCache(); 
  const failKey = 'staffpinfail_' + division + '_' + outlet + '_' + name; 
  const fails = parseInt(cache.get(failKey) || '0'); 
  if (fails >= 5) {
    return { authorized: false, error: 'Too many attempts. Please wait a few minutes and try again.' }; 
  }

  const rosterRows = getRosterRows(); 
  if (!rosterRows.length) return { authorized: false, error: 'Staff roster not set up yet — ask your manager.' }; 

  const match = rosterRows.find(r => 
    (r.Division || '').toString().trim().toLowerCase() === division && 
    (r.Outlet || '').toString().trim().toUpperCase() === outlet && 
    (r.Name || '').toString().trim().toUpperCase() === name
  ); 

  if (!match || !passcode || (match.Passcode || '').toString().trim() !== passcode) {
    cache.put(failKey, (fails + 1).toString(), 300); 
    return { authorized: false }; 
  }

  cache.remove(failKey); 
  const scopeType = division === 'warehouse' ? 'staff_warehouse' : 'staff_retail'; 
  const scopeKey = outlet + '|' + name; 
  const token = issueSessionToken(scopeType, scopeKey); 
  // v1.27: return the scoped data right here instead of making the frontend
  // ask for it in a second request — one round-trip instead of two.
  return Object.assign({ authorized: true, token: token }, buildScopedData(scopeType, scopeKey)); 
}

// Outlet Manager / Warehouse Manager picking their outlet, or Area Manager
// picking their name+outlet — all already passed the Manager-category PIN to
// reach this screen. This re-checks that same PIN once more (defense in
// depth, same pattern as Manage Staff/Manage Resources) and issues a token
// scoped to the ONE outlet/location selected. Supervisor uses this too, with
// scopeKey 'ALL' — the one role that's intentionally unscoped.
function handleEstablishSession(data) {
  const role = (data.role || '').toString(); 
  const pin = (data.pin || '').toString(); 
  const validRoles = { 
    'outlet_manager': 'resources', 'warehouse_manager': 'resources', 
    'area_manager': 'resources', 'supervisor': 'supervisor' 
  }; 
  const pinRole = validRoles[role]; 
  if (!pinRole) return { authorized: false, error: 'Unknown role.' }; 

  const check = checkPinInternal(pinRole, pin); 
  if (!check.ok) return { authorized: false, error: check.error || 'Incorrect password.' }; 

  const scopeKey = role === 'supervisor' ? 'ALL' : (data.outlet || '').toString().trim().toUpperCase(); 
  if (role !== 'supervisor' && !scopeKey) return { authorized: false, error: 'Select an outlet/location first.' }; 

  const token = issueSessionToken(role, scopeKey); 
  // v1.27: same one-round-trip optimization as staff login.
  // v1.35: Supervisor defaults to the last 3 months so the very first load
  // stays fast; the dashboard offers an explicit control to pull further back.
  const defaultWindow = (role === 'supervisor') ? 3 : 0; 
  return Object.assign({ authorized: true, token: token }, buildScopedData(role, scopeKey, defaultWindow)); 
}

// v1.27: extracted so establish_session and verify_staff_login can build and
// return this data in the SAME response that issues the token, instead of
// the frontend needing a second round-trip to fetch it separately. Cuts
// every login's network time roughly in half.
// v1.35: windowMonths limits how far back history is returned. Filtering
// happens HERE, server-side, so old rows never get serialized into JSON or
// sent over the network at all — this shrinks the actual payload rather than
// just hiding rows after they've already been transferred and parsed.
// null/0 means "everything", used when someone explicitly asks for full history.
function buildScopedData(scopeType, scopeKey, windowMonths) {
  const empty = { results: [], archiveResults: [], reports: [], archiveReports: [], wrongAnswers: [], 
    aiResults: [], aiWrongAnswers: [], content: [], referenceDocs: [], resourceSyncStats: null }; 

  let cutoff = null; 
  if (windowMonths && windowMonths > 0) {
    cutoff = new Date(); 
    cutoff.setMonth(cutoff.getMonth() - windowMonths); 
  }
  // Rows with an unparseable/missing timestamp are KEPT rather than dropped —
  // silently hiding a report because its date cell was malformed would be a
  // far worse failure than showing one extra row.
  const inWindow = function(r) {
    if (!cutoff) return true; 
    const raw = r.Timestamp || r.Date; 
    if (!raw) return true; 
    const d = new Date(raw); 
    if (isNaN(d.getTime())) return true; 
    return d >= cutoff; 
  }; 

  // Resources are company-wide and identical for every single login, yet the
  // Drive walk (getReferenceDocs) is one of the slowest things this whole
  // app does — each file touched costs a real round-trip to Drive. Caching
  // the result for a few minutes means only the first login in that window
  // pays the cost; everyone else gets it back instantly. Freshness
  // trade-off: a newly uploaded file can take up to this long to show up —
  // acceptable, since resources don't change minute-to-minute in practice.
  const RESOURCES_CACHE_SECONDS = 300; // 5 minutes
  const cache = CacheService.getScriptCache(); 
  let referenceDocs, syncStats; 
  const cachedResources = cache.get('resource_cache_docs'); 
  const cachedStats = cache.get('resource_cache_stats'); 
  if (cachedResources) {
    try { referenceDocs = JSON.parse(cachedResources); syncStats = cachedStats ? JSON.parse(cachedStats) : null; } catch (e) { referenceDocs = null; } 
  }
  if (!referenceDocs) {
    referenceDocs = []; 
    try { referenceDocs = getReferenceDocs(); syncStats = lastResourceSyncStats; } catch (e) { Logger.log("Reference Docs fetch skipped: " + e.toString()); } 
    try {
      cache.put('resource_cache_docs', JSON.stringify(referenceDocs), RESOURCES_CACHE_SECONDS); 
      cache.put('resource_cache_stats', JSON.stringify(syncStats), RESOURCES_CACHE_SECONDS); 
    } catch (e) { /* payload too large for cache — just skip caching this time */ } 
  }
  const content = SS.getSheetByName("Content") ? getSheetData(SS.getSheetByName("Content")) : []; 

  // Resources are company-wide, not per-outlet — every scope below gets them.
  const base = Object.assign({}, empty, { authorized: true, content: content, referenceDocs: referenceDocs, resourceSyncStats: syncStats }); 

  if (scopeType === 'staff_retail') {
    const [outlet, name] = scopeKey.split('|'); 
    const allResults = getSheetData(SS.getSheetByName("Results")); 
    const allWrong = SS.getSheetByName("WrongAnswers") ? getSheetData(SS.getSheetByName("WrongAnswers")) : []; 
    const allAI = SS.getSheetByName("AIResults") ? getSheetData(SS.getSheetByName("AIResults")) : []; 
    const allAIWrong = SS.getSheetByName("AIWrongAnswers") ? getSheetData(SS.getSheetByName("AIWrongAnswers")) : []; 
    const allReports = SS.getSheetByName("Reports") ? getSheetData(SS.getSheetByName("Reports")) : []; 
    const mine = r => (r.Outlet||'').toString().trim().toUpperCase() === outlet && (r["Name"]||r["Staff Name"]||'').toString().trim().toUpperCase() === name; 
    base.results = allResults.filter(mine); 
    base.wrongAnswers = allWrong.filter(mine); 
    base.aiResults = allAI.filter(mine); 
    base.aiWrongAnswers = allAIWrong.filter(r => (r.Outlet||'').toString().trim().toUpperCase() === outlet && (r["Staff Name"]||'').toString().trim().toUpperCase() === name); 
    // v1.28: Area Manager reports about THIS staff member specifically —
    // view-only on the frontend, never editable from the staff side.
    base.reports = allReports.filter(mine); 
    return base; 
  }

  if (scopeType === 'staff_warehouse') {
    const [outlet, name] = scopeKey.split('|'); 
    const allAI = SS.getSheetByName("AIResults") ? getSheetData(SS.getSheetByName("AIResults")) : []; 
    const allAIWrong = SS.getSheetByName("AIWrongAnswers") ? getSheetData(SS.getSheetByName("AIWrongAnswers")) : []; 
    base.aiResults = allAI.filter(r => (r.Outlet||'').toString().trim().toUpperCase() === outlet && (r["Name"]||'').toString().trim().toUpperCase() === name); 
    base.aiWrongAnswers = allAIWrong.filter(r => (r.Outlet||'').toString().trim().toUpperCase() === outlet && (r["Staff Name"]||'').toString().trim().toUpperCase() === name); 
    return base; 
  }

  if (scopeType === 'outlet_manager') {
    const allAI = SS.getSheetByName("AIResults") ? getSheetData(SS.getSheetByName("AIResults")) : []; 
    const allAIWrong = SS.getSheetByName("AIWrongAnswers") ? getSheetData(SS.getSheetByName("AIWrongAnswers")) : []; 
    const allResults = getSheetData(SS.getSheetByName("Results")); 
    const allWrong = SS.getSheetByName("WrongAnswers") ? getSheetData(SS.getSheetByName("WrongAnswers")) : []; 
    const allReports = SS.getSheetByName("Reports") ? getSheetData(SS.getSheetByName("Reports")) : []; 
    const mine = r => (r.Outlet||'').toString().trim().toUpperCase() === scopeKey; 
    base.aiResults = allAI.filter(mine); 
    base.aiWrongAnswers = allAIWrong.filter(mine); 
    // v1.28: Standard Quiz results and Area Manager reports for every staff
    // member at this outlet — new for the outlet-wide Review view. Outlet
    // Manager never had visibility into either of these before.
    base.results = allResults.filter(mine); 
    base.reports = allReports.filter(mine); 
    // v1.30: the wrong-answer DETAIL behind those Standard Quiz scores —
    // which specific questions each staff member missed, not just their
    // percentage. This existed for AI Practice already; Standard Quiz was
    // missing the same visibility.
    base.wrongAnswers = allWrong.filter(mine); 
    return base; 
  }

  if (scopeType === 'warehouse_manager') {
    const allAI = SS.getSheetByName("AIResults") ? getSheetData(SS.getSheetByName("AIResults")) : []; 
    const allAIWrong = SS.getSheetByName("AIWrongAnswers") ? getSheetData(SS.getSheetByName("AIWrongAnswers")) : []; 
    base.aiResults = allAI.filter(r => (r.Outlet||'').toString().trim().toUpperCase() === scopeKey); 
    base.aiWrongAnswers = allAIWrong.filter(r => (r.Outlet||'').toString().trim().toUpperCase() === scopeKey); 
    return base; 
  }

  if (scopeType === 'area_manager') {
    const allResults = getSheetData(SS.getSheetByName("Results")); 
    const allReports = SS.getSheetByName("Reports") ? getSheetData(SS.getSheetByName("Reports")) : []; 
    const allArchiveResults = SS.getSheetByName("Archive_Results") ? getSheetData(SS.getSheetByName("Archive_Results")) : []; 
    const allArchiveReports = SS.getSheetByName("Archive_Reports") ? getSheetData(SS.getSheetByName("Archive_Reports")) : []; 
    const allWrong = SS.getSheetByName("WrongAnswers") ? getSheetData(SS.getSheetByName("WrongAnswers")) : []; 
    const mine = r => (r.Outlet||'').toString().trim().toUpperCase() === scopeKey; 
    base.results = allResults.filter(mine); 
    base.archiveResults = allArchiveResults.filter(mine); 
    base.reports = allReports.filter(mine); 
    base.archiveReports = allArchiveReports.filter(mine); 
    base.wrongAnswers = allWrong.filter(mine); 
    return base; 
  }

  if (scopeType === 'category_gate') {
    return base; // resources only — nothing else was proven at this level
  }

  if (scopeType === 'supervisor') {
    // Supervisor is the only unscoped role, so it's the one that actually
    // feels data growth. When a window is active we also skip the Archive_*
    // sheets entirely — they only ever hold OLDER rows, so reading them in
    // windowed mode is pure wasted work and wasted payload.
    base.results = getSheetData(SS.getSheetByName("Results")).filter(inWindow); 
    base.reports = SS.getSheetByName("Reports") ? getSheetData(SS.getSheetByName("Reports")).filter(inWindow) : []; 
    base.wrongAnswers = SS.getSheetByName("WrongAnswers") ? getSheetData(SS.getSheetByName("WrongAnswers")).filter(inWindow) : []; 
    base.aiResults = SS.getSheetByName("AIResults") ? getSheetData(SS.getSheetByName("AIResults")).filter(inWindow) : []; 
    base.aiWrongAnswers = SS.getSheetByName("AIWrongAnswers") ? getSheetData(SS.getSheetByName("AIWrongAnswers")).filter(inWindow) : []; 
    if (cutoff) {
      base.archiveResults = []; 
      base.archiveReports = []; 
    } else {
      base.archiveResults = SS.getSheetByName("Archive_Results") ? getSheetData(SS.getSheetByName("Archive_Results")) : []; 
      base.archiveReports = SS.getSheetByName("Archive_Reports") ? getSheetData(SS.getSheetByName("Archive_Reports")) : []; 
    }
    base.windowMonths = windowMonths || 0; 
    return base; 
  }

  return { authorized: false, error: 'Unrecognized session.' }; 
}

function handleGetScopedData(data) {
  const session = readSessionToken((data.token || '').toString()); 
  if (!session) return { authorized: false, error: 'Your session has expired — please log in again.' }; 
  // A client may request a different window (e.g. Supervisor choosing
  // 'All time'); 0/absent means no limit.
  const win = parseInt(data.windowMonths); 
  return buildScopedData(session.scopeType, session.scopeKey, isNaN(win) ? 0 : win); 
}

function checkPinInternal(role, pin) {
  const propKeyMap = {
    'area_manager': 'AREA_MANAGER_PIN', 
    'outlet_manager': 'OUTLET_MANAGER_PIN', 
    'supervisor': 'SUPERVISOR_PIN', 
    // v1.17: this key is FLT2026 — the Manager-category PIN entered once at
    // the category-select screen. It's also reused server-side to protect
    // Content upload/delete and, as of v1.21, all Manage Staff actions
    // (add/remove/lookup passcodes). "resources" is a legacy name from when
    // this only guarded viewing Resources (v1.15) — kept as-is rather than
    // renamed, to avoid breaking anyone who already set RESOURCES_PASSCODE.
    'resources': 'RESOURCES_PASSCODE'
  }; 
  const defaultPins = {
    'area_manager': '1234', 
    'outlet_manager': '1234', 
    'supervisor': 'SV2026', 
    'resources': 'FLT2026'
  }; 

  const propKey = propKeyMap[role]; 
  if (!propKey) return { ok: false, error: 'Unknown login type.' }; 

  const cache = CacheService.getScriptCache(); 
  const failKey = 'pinfail_' + role; 
  const fails = parseInt(cache.get(failKey) || '0'); 
  if (fails >= 5) {
    return { ok: false, error: 'Too many attempts. Please wait a few minutes and try again.' }; 
  }

  const props = PropertiesService.getScriptProperties(); 
  const correctPin = props.getProperty(propKey) || defaultPins[role]; 

  if (pin && pin === correctPin) {
    cache.remove(failKey); 
    return { ok: true, error: null }; 
  }

  cache.put(failKey, (fails + 1).toString(), 300); 
  return { ok: false, error: null }; 
}

function handleVerifyPin(data) {
  const role = (data.role || '').toString(); 
  const pin = (data.pin || '').toString(); 
  const result = checkPinInternal(role, pin); 
  if (!result.ok) return { authorized: false, error: result.error }; 

  // v1.26: the Manager-category gate (role 'resources', FLT2026) doubles as
  // entry to Resources directly from the tile grid, without necessarily
  // picking a specific sub-role first — so it gets its own minimal token,
  // scoped to just Resources, immediately on success.
  if (role === 'resources') {
    const token = issueSessionToken('category_gate', 'ALL'); 
    return Object.assign({ authorized: true, token: token }, buildScopedData('category_gate', 'ALL')); 
  }
  return { authorized: true }; 
}

// ============================================================
// v1.21 ADDITION: STAFF ROSTER (passcode-based staff identity)
// ------------------------------------------------------------
// One sheet, "StaffRoster", serves both Retail and Warehouse — filtered by
// the Division column. Columns: Division | Outlet | Name | IDNote | Passcode
// | AddedBy | Timestamp. "Outlet" holds a Retail outlet code (AJ, PDM, etc.)
// or a Warehouse location (Taskforce/Warehouse/Inventory/Logistic).
//
// Security model: names are public (doGet() returns them, minus Passcode,
// via getPublicStaffRoster() — needed so the login picker can show a name
// list before anyone's authenticated). Passcodes never appear in that
// payload. The only two ways a passcode is ever read back are:
//   1. handleVerifyStaffLogin — checks a submitted passcode server-side and
//      returns true/false only, never the passcode itself. Rate-limited per
//      person (5 wrong tries / 5 min) so a specific staff member's 4-digit
//      code can't be brute-forced, without locking out unrelated staff.
//   2. handleGetStaffRosterFull — used by the Manage Staff panel so a
//      manager can look up a forgotten passcode. Gated by the same
//      RESOURCES_PASSCODE (FLT2026) used for the Manager-category screens.
// ============================================================

// v1.35: the StaffRoster sheet is read on EVERY staff login and every public
// page load, but it only changes when a manager explicitly adds or removes
// someone — the highest read-to-write ratio of any sheet in this app. Caching
// it removes a full sheet read + row-to-object conversion from the single
// most frequent operation the backend performs.
//
// Deliberately NOT applied to Results/Reports/AIResults: those are written
// constantly (every quiz attempt), and a manager opening Staff Review expects
// to see the attempt that just happened, not a snapshot from minutes ago.
// Caching those would trade correctness for speed. The roster is the one
// sheet where "changes rarely, read constantly" actually holds.
//
// Invalidation is explicit (see invalidateRosterCache below) rather than
// purely time-based, so a manager adding staff sees the change immediately
// instead of waiting out a timer.
const ROSTER_CACHE_KEY = 'staff_roster_rows_v1';
const ROSTER_CACHE_SECONDS = 900; // 15 min ceiling; explicit invalidation handles real changes

function getRosterRows() {
  const cache = CacheService.getScriptCache(); 
  const hit = cache.get(ROSTER_CACHE_KEY); 
  if (hit) {
    try { return JSON.parse(hit); } catch (e) { /* fall through and re-read */ }
  }
  const sheet = SS.getSheetByName("StaffRoster"); 
  if (!sheet) return []; 
  const rows = getSheetData(sheet); 
  try {
    cache.put(ROSTER_CACHE_KEY, JSON.stringify(rows), ROSTER_CACHE_SECONDS); 
  } catch (e) { /* too large for cache — still return the fresh rows */ }
  return rows; 
}

function invalidateRosterCache() {
  try { CacheService.getScriptCache().remove(ROSTER_CACHE_KEY); } catch (e) {} 
}

function getPublicStaffRoster() {
  return getRosterRows().map(r => ({ Division: r.Division, Outlet: r.Outlet, Name: r.Name, IDNote: r.IDNote })); 
}

// Confirms the session token really is a manager scoped to THIS division and
// outlet — not just anyone who knows the Manager-category PIN. Before this,
// add_staff/remove_staff accepted any outlet as long as the PIN was right,
// meaning one manager could edit another outlet's roster.
function checkManagerScope(token, division, outlet) {
  const session = readSessionToken(token); 
  const expectedType = division === 'warehouse' ? 'warehouse_manager' : 'outlet_manager'; 
  return !!(session && session.scopeType === expectedType && session.scopeKey === outlet); 
}

// Manager-facing: full roster (including passcodes) for one division+outlet,
// so a manager can look up someone's forgotten code. Gated server-side.
function handleGetStaffRosterFull(data) {
  const division = (data.division || '').toString().trim().toLowerCase(); 
  const outlet = (data.outlet || '').toString().trim().toUpperCase(); 
  if (!checkManagerScope((data.token || '').toString(), division, outlet)) {
    return { authorized: false, error: 'Your session has expired — please log in again.' }; 
  }

  const staff = getRosterRows().filter(r => 
    (r.Division || '').toString().trim().toLowerCase() === division && 
    (r.Outlet || '').toString().trim().toUpperCase() === outlet
  ); 
  return { authorized: true, staff: staff }; 
}

function handleAddStaff(data) {
  const division = (data.division || '').toString().trim(); 
  const outlet = (data.outlet || '').toString().trim().toUpperCase(); 
  if (!checkManagerScope((data.token || '').toString(), division.toLowerCase(), outlet)) {
    return { status: 'unauthorized', error: 'Your session has expired — please log in again.' }; 
  }

  const name = (data.name || '').toString().trim().toUpperCase(); 
  const idNote = (data.idNote || '').toString().trim(); 
  const passcode = (data.passcode || '').toString().trim(); 

  if (!name || !/^\d{4}$/.test(passcode)) {
    return { status: 'error', error: 'Name and a 4-digit passcode are both required.' }; 
  }

  let sheet = SS.getSheetByName("StaffRoster") || SS.insertSheet("StaffRoster"); 
  if (sheet.getLastRow() === 0) sheet.appendRow(["Division", "Outlet", "Name", "IDNote", "Passcode", "AddedBy", "Timestamp"]); 

  const rows = sheet.getDataRange().getValues(); 
  for (let i = 1; i < rows.length; i++) {
    if ((rows[i][0]||'').toString().trim().toLowerCase() === division.toLowerCase() && 
        (rows[i][1]||'').toString().trim().toUpperCase() === outlet && 
        (rows[i][2]||'').toString().trim().toUpperCase() === name) {
      return { status: 'error', error: 'Someone with that exact name is already on this list — add an ID/Note to tell them apart, or edit the existing entry.' }; 
    }
  }

  // Leading apostrophe keeps a passcode like "0042" from losing its zero.
  sheet.appendRow([division, outlet, name, idNote, "'" + passcode, data.addedBy || '', new Date()]); 
  invalidateRosterCache(); 
  return { status: 'ok' }; 
}

function handleRemoveStaff(data) {
  const division = (data.division || '').toString().trim().toLowerCase(); 
  const outlet = (data.outlet || '').toString().trim().toUpperCase(); 
  if (!checkManagerScope((data.token || '').toString(), division, outlet)) {
    return { status: 'unauthorized', error: 'Your session has expired — please log in again.' }; 
  }

  const name = (data.name || '').toString().trim().toUpperCase(); 

  const sheet = SS.getSheetByName("StaffRoster"); 
  if (sheet) {
    const rows = sheet.getDataRange().getValues(); 
    for (let i = 1; i < rows.length; i++) {
      if ((rows[i][0]||'').toString().trim().toLowerCase() === division && 
          (rows[i][1]||'').toString().trim().toUpperCase() === outlet && 
          (rows[i][2]||'').toString().trim().toUpperCase() === name) {
        sheet.deleteRow(i + 1); 
        break; 
      }
    }
  }
  // Security-critical: without this, a removed staff member could still log
  // in until the cache expired. Invalidating here closes that window.
  invalidateRosterCache(); 
  return { status: 'ok' }; 
}

// v1.24: direct file upload from the Manage Resources panel — Supervisor only.
// The file is decoded server-side and dropped straight into the matching
// category subfolder, using the exact same folder-name matching as manual
// Drive uploads, so it's indistinguishable from a file dropped in by hand.
const UPLOAD_CATEGORIES = [
  '101 Guide to Retailing', 'Housebrand Modules', 'General Policies', 
  'Warehousing Handbook', 'eLearning Courses', 'Halal Certificate'
]; 

function handleUploadResourceFile(data) {
  const check = checkPinInternal('supervisor', (data.pin || '').toString()); 
  if (!check.ok) return { status: 'unauthorized', error: check.error || 'Incorrect password.' }; 

  const category = (data.category || '').toString().trim(); 
  const fileName = (data.fileName || '').toString().trim(); 
  const mimeType = (data.mimeType || 'application/octet-stream').toString(); 
  const base64Data = (data.base64Data || '').toString(); 

  if (UPLOAD_CATEGORIES.indexOf(category) === -1) return { status: 'error', error: 'Choose a valid category.' }; 
  if (!fileName) return { status: 'error', error: 'That file has no name — try again.' }; 
  if (!base64Data) return { status: 'error', error: 'No file data received — try again, or use a smaller file.' }; 
  if (!REFERENCE_FOLDER_ID || REFERENCE_FOLDER_ID.indexOf("PASTE_YOUR") === 0) return { status: 'error', error: 'Reference folder is not configured yet — ask whoever manages the backend.' }; 

  try {
    const bytes = Utilities.base64Decode(base64Data); 
    // ~15MB ceiling on the client already blocks most oversized uploads before
    // they get here — this is a second check in case that was bypassed.
    if (bytes.length > 20 * 1024 * 1024) return { status: 'error', error: 'That file is too large — please keep uploads under 15MB.' }; 

    const blob = Utilities.newBlob(bytes, mimeType, fileName); 
    const parent = DriveApp.getFolderById(REFERENCE_FOLDER_ID); 
    const targetFolder = getOrCreateFolder(parent, category); 
    targetFolder.createFile(blob); 
    return { status: 'ok' }; 
  } catch (e) {
    return { status: 'error', error: 'Upload failed: ' + e.toString() }; 
  }
}
