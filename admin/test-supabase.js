// Test-Script für Supabase-Verbindung
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'http://127.0.0.1:54321';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function testConnection() {
  console.log('🔍 Teste Supabase-Verbindung...\n');
  
  try {
    // Test 1: Jobs-Tabelle
    console.log('1️⃣ Prüfe jobs-Tabelle...');
    const jobsResult = await supabase
      .from('jobs')
      .select('id, pickup_name, dropoff_name, ride_date, etd, status, driver_id')
      .limit(10);
    
    if (jobsResult.error) {
      console.error('❌ Fehler beim Laden der Jobs:', jobsResult.error.message);
      console.error('   Details:', jobsResult.error);
    } else {
      console.log(`✅ Jobs-Tabelle gefunden! ${jobsResult.data?.length || 0} Einträge geladen`);
      if (jobsResult.data?.length > 0) {
        console.log('   Beispiel-Job:', JSON.stringify(jobsResult.data[0], null, 2));
      } else {
        console.log('   ⚠️  Die jobs-Tabelle ist leer!');
      }
    }
    
    // Test 2: Profiles-Tabelle
    console.log('\n2️⃣ Prüfe profiles-Tabelle...');
    const profilesResult = await supabase
      .from('profiles')
      .select('id, first_name, last_name, driver_number')
      .limit(5);
    
    if (profilesResult.error) {
      console.error('❌ Fehler beim Laden der Profile:', profilesResult.error.message);
    } else {
      console.log(`✅ Profiles-Tabelle gefunden! ${profilesResult.data?.length || 0} Einträge`);
    }
    
    // Test 3: Guests-Tabelle
    console.log('\n3️⃣ Prüfe guests-Tabelle...');
    const guestsResult = await supabase
      .from('guests')
      .select('id, first_name, last_name')
      .limit(5);
    
    if (guestsResult.error) {
      console.error('❌ Fehler beim Laden der Gäste:', guestsResult.error.message);
    } else {
      console.log(`✅ Guests-Tabelle gefunden! ${guestsResult.data?.length || 0} Einträge`);
    }
    
    // Test 4: Convoys-Tabelle
    console.log('\n4️⃣ Prüfe convoys-Tabelle...');
    const convoysResult = await supabase
      .from('convoys')
      .select('id, name')
      .limit(5);
    
    if (convoysResult.error) {
      console.error('❌ Fehler beim Laden der Konvois:', convoysResult.error.message);
    } else {
      console.log(`✅ Convoys-Tabelle gefunden! ${convoysResult.data?.length || 0} Einträge`);
    }
    
    // Test 5: Job_guests-Tabelle
    console.log('\n5️⃣ Prüfe job_guests-Tabelle...');
    const jobGuestsResult = await supabase
      .from('job_guests')
      .select('job_id, guest_id, is_main_contact')
      .limit(5);
    
    if (jobGuestsResult.error) {
      console.error('❌ Fehler beim Laden der Job-Gäste:', jobGuestsResult.error.message);
    } else {
      console.log(`✅ Job_guests-Tabelle gefunden! ${jobGuestsResult.data?.length || 0} Einträge`);
    }
    
    console.log('\n📊 Zusammenfassung:');
    console.log('-------------------');
    if (jobsResult.error) {
      console.log('❌ Die jobs-Tabelle existiert nicht oder ist nicht erreichbar!');
      console.log('💡 Lösung: Führe das Schema-Script aus:');
      console.log('   cd fahrer-app-lokal && psql -d postgres -f db/rebuild_full_schema.sql');
    } else if (jobsResult.data?.length === 0) {
      console.log('⚠️  Die Datenbank ist korrekt eingerichtet, aber es gibt keine Fahrten!');
      console.log('💡 Lösung: Erstelle Testdaten oder füge Fahrten über die App hinzu.');
    } else {
      console.log('✅ Alles funktioniert! Fahrten vorhanden.');
    }
    
  } catch (error) {
    console.error('\n❌ Unerwarteter Fehler:', error);
  }
}

testConnection();
