// Confirmed lessons from the coaching app's private Sheet. The owner copies that Sheet's ID into the desk's script
// property CTTC_COACHING_DB_ID; without it the desk works as before.
function coachingLessons_(sessionDate) {
  var id = PropertiesService.getScriptProperties().getProperty('CTTC_COACHING_DB_ID');
  if (!id) return [];
  var book = SpreadsheetApp.openById(id);
  function table(name) {
    var sheet = book.getSheetByName(name);
    if (!sheet) return [];
    var values = sheet.getDataRange().getValues();
    var headers = values[0].map(String);
    return values.slice(1).map(function (row) {
      var entry = {};
      headers.forEach(function (header, column) { entry[header] = row[column] == null ? '' : row[column]; });
      return entry;
    });
  }
  var coaches = {};
  table('Coaches').forEach(function (coach) {
    if (coach.coach_id && String(coach.status).trim().toLowerCase() !== 'disabled') coaches[coach.coach_id] = coach;
  });
  var phones = {};
  table('Students').forEach(function (student) { phones[String(student.email).toLowerCase()] = student.phone; });
  var people = [];
  table('Requests').forEach(function (request) {
    if (String(request.status) !== 'confirmed' || displayDate_(request.date) !== sessionDate) return;
    var coach = coaches[request.coach_id];
    if (!coach) return;
    var lesson = { start: String(request.start), minutes: Number(request.minutes), coachLabel: String(coach.label) };
    people.push({ role: 'coach', name: String(coach.name), phone: String(coach.phone), lesson: lesson });
    if (request.student_name) {
      people.push({ role: 'student', name: String(request.student_name), phone: String(phones[String(request.student_email).toLowerCase()] || ''), lesson: lesson });
    }
  });
  return people;
}

function coachingPhoneKey_(phone) {
  var digits = String(phone || '').replace(/\D/g, '');
  return digits.length >= 10 ? 'phone:' + digits.slice(-10) : '';
}

// Coaches and students with a confirmed lesson that day, matched to the directory where the name is unambiguous.
function getCoachingParticipants(sessionDate) {
  validateSessionDate_(sessionDate);
  var people = coachingLessons_(sessionDate);
  if (!people.length) return [];
  var match = voiceMatcher_();
  var byPerson = {};
  people.forEach(function (person) {
    var ids = match({ known: true, senderKey: voiceNameKey_(person.name) });
    var playerId = ids.length === 1 ? ids[0] : '';
    var key = playerId || person.role + ':' + voiceNameKey_(person.name);
    var entry = byPerson[key] || (byPerson[key] = { playerId: playerId, name: person.name, role: person.role, lessons: [] });
    if (person.role === 'coach') entry.role = 'coach';
    entry.lessons.push({ start: person.lesson.start, minutes: person.lesson.minutes, coachLabel: person.lesson.coachLabel });
  });
  return Object.keys(byPerson).map(function (key) {
    var entry = byPerson[key];
    entry.lessons.sort(function (left, right) { return left.start < right.start ? -1 : left.start > right.start ? 1 : 0; });
    return entry;
  }).sort(function (left, right) {
    if (left.role !== right.role) return left.role === 'coach' ? -1 : 1;
    return left.lessons[0].start < right.lessons[0].start ? -1 : left.lessons[0].start > right.lessons[0].start ? 1 : left.name.localeCompare(right.name);
  });
}
