import './support';
import path from 'path';
import rimraf from 'rimraf';
import {ReactiveTest, TestScheduler} from 'rx';

import DictionarySync from '../src/dictionary-sync';
import SpellCheckHandler from '../src/spell-check-handler';

const d = require('debug')('electron-spellchecker-test:spell-check-handler');

let testCount = 0;

const deDE = "Rechtschreibprüfungsleid ist eine Grunderfahrung und bezeichnet als Sammelbegriff all dasjenige, was einen Menschen körperlich und seelisch belastet.";

class FakeLocalStorage {
  constructor() {
    this.ls = {};
  }
  
  getItem(item) {
    return this.ls[item];
  }
  
  setItem(item, val) {
    this.ls[item] = val;
  }
}

describe('The Spell Check Handler Class', function() {
  beforeEach(function() {
    this.tempCacheDir = path.join(__dirname, `__spell_check${testCount++}`);
    this.sync = new DictionarySync(this.tempCacheDir);
    this.fixture = new SpellCheckHandler(this.sync, new FakeLocalStorage());
  });

  afterEach(function() {
    //console.log(this.tempCacheDir);
    rimraf.sync(this.tempCacheDir);
  });

  describe('buildLikelyLocaleTable method', function() {
    it('should have en in the list', async function() {
      let result = await SpellCheckHandler.buildLikelyLocaleTable();
      d(JSON.stringify(result));
    
      expect(result['en']).to.be.ok;
    });
  });

  describe('the setLanguage method', function() {
    this.timeout(30*1000);

    it('should load a bunch of common languages', async function() {
      await this.fixture.switchLanguage('en-US');

      expect(this.fixture.currentSpellchecker.isMisspelled('bucket')).not.to.be.ok;
      expect(this.fixture.currentSpellchecker.isMisspelled('Eimer')).to.be.ok;

      await this.fixture.switchLanguage('de-DE');

      expect(this.fixture.currentSpellchecker.isMisspelled('bucket')).to.be.ok;
      expect(this.fixture.currentSpellchecker.isMisspelled('Eimer')).not.to.be.ok;
    });
  });

  describe('the attachToInput method', function() {
    it('should use TestScheduler correctly', function() {
      let scheduler = new TestScheduler();
      let input = scheduler.createHotObservable(
        ReactiveTest.onNext(250, 'This is a test of a long english sentence')
      );

      let items = [];
      input.subscribe((x) => items.push(x));

      expect(items.length).to.equal(0);

      scheduler.advanceTo(100);
      expect(items.length).to.equal(0);

      scheduler.advanceTo(300);
      expect(items.length).to.equal(1);
    });

    it('should detect the simple case of pasting in a long string', async function() {
      this.timeout(15 * 1000);

      let scheduler = new TestScheduler();
      let input = scheduler.createHotObservable(
        ReactiveTest.onNext(250, 'This is a test of a long english sentence')
      );

      this.fixture.scheduler = scheduler;
      this.fixture.attachToInput(input);

      expect(this.fixture.currentSpellcheckerLanguage).not.to.be.ok;
      
      scheduler.advanceTo(10 *1000);
      await this.fixture.currentSpellcheckerChanged.take(1).toPromise();

      expect(this.fixture.currentSpellcheckerLanguage).to.equal('en-US');
    });
    
    it('shouldnt call cld over and over while users are typing', async function() {
      let scheduler = new TestScheduler();
      let input = scheduler.createHotObservable(
        ReactiveTest.onNext(10, 'T'),
        ReactiveTest.onNext(15, 'Th'),
        ReactiveTest.onNext(20, 'Thi'),
        ReactiveTest.onNext(25, 'This'),
        ReactiveTest.onNext(150, ''),
        ReactiveTest.onNext(160, 'This is a test of a long english sentence')
      );

      this.fixture.scheduler = scheduler;
      this.fixture.attachToInput(input);
      
      let langDetectCount = 0;
      this.fixture.detectLanguageForText = function(text) {
        langDetectCount++;
        return (text.length > 10) ? Promise.resolve('en') : Promise.reject(new Error("Couldn't detect"));
      };
      
      let currentLanguage = null;
      this.fixture.switchLanguage = function(lang) {
        currentLanguage = lang;
        return Promise.resolve(true);
      };

      expect(this.fixture.currentSpellcheckerLanguage).not.to.be.ok;
      
      d(`Advancing to 20`);
      scheduler.advanceTo(10);
      expect(langDetectCount).to.equal(0);
      scheduler.advanceTo(15);
      expect(langDetectCount).to.equal(0);
      scheduler.advanceTo(20);
      expect(langDetectCount).to.equal(0);
      
      d(`Advancing to 150`);
      scheduler.advanceTo(150);
      expect(langDetectCount).to.equal(0);
      scheduler.advanceTo(160);
      expect(langDetectCount).to.equal(0);
      
      d(`Advancing to +20sec`);
      scheduler.advanceTo(20 * 1000);
          
      // NB: Because we still use Promises that _always_ schedule, we have to spin
      // the event loop :-/
      await new Promise((req) => setTimeout(req, 20));
      
      expect(langDetectCount).to.equal(2);
      expect(currentLanguage).to.equal('en-US');
    });
    
    it('should switch languages if users type different text', async function() {
      this.timeout(15 * 1000);

      let scheduler = new TestScheduler();
      let input = scheduler.createHotObservable(
        ReactiveTest.onNext(10, 'This is a test of a long english sentence'),
        ReactiveTest.onNext(15*1000, ''),
        ReactiveTest.onNext(30*1000, deDE)
      ).do((x) => d(`Emitted ${x}`)).publish().refCount();

      this.fixture.scheduler = scheduler;
      this.fixture.attachToInput(input);

      expect(this.fixture.currentSpellcheckerLanguage).not.to.be.ok;
        
      d('Advancing to +10s');
      scheduler.advanceTo(10*1000);
      await this.fixture.currentSpellcheckerChanged.take(1).toPromise();
      expect(this.fixture.currentSpellcheckerLanguage).to.equal('en-US');    
      
      d('Advancing to +20s');
      scheduler.advanceTo(20*1000);
      await new Promise((req) => setTimeout(req, 50));
      expect(this.fixture.currentSpellcheckerLanguage).to.equal('en-US');    
      
      d('Advancing to +60s');
      scheduler.advanceTo(60*1000);
      await this.fixture.currentSpellcheckerChanged.take(1).toPromise();
      expect(this.fixture.currentSpellcheckerLanguage.substring(0,2)).to.equal('de');
    });
  });
});