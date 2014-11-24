var casper = require('casper').create(
  { pageSettings: { loadImages: false
                  , webSecurityEnabled: false
                  }
  // , verbose: true
  // , logLevel: "debug"
  }
);

casper.options.viewportSize = {width: 1024, height: 600}

casper.on('complete.error', function(err) {
    this.die("Complete callback has failed: " + err);
});

casper.on('load.failed', function(err) {
    this.echo("Loading has failed", "WARNING");
    utils.dump(err);
    this.die("Loading has failed ^^", "WARNING");
});

var colorizer = require('colorizer').create('Colorizer');
var fs = require('fs'); // NOTE: this is not the node fs, but the phantonjs :(
var utils = require('utils');
var path = require('path');
var moment = require('moment');

var system = require('system');
var env = system.env;

var process = require("child_process")
var spawn = process.spawn

// -------------------------------------------------------------------------- //

var jQueryPath = "include/jquery-2.1.1.min.js";

var baseDLPath = "downloads/"

// -------------------------------------------------------------------------- //

settings = { username : ''
           , password : ''
           }

function initializeSettings() {
    if (! env['HOME']) {
        casper.die('Could not find home');
    }



    var homeDir = env['HOME'];

    var settingsPath = path.join(homeDir, '.itslrn');
    var readSettings = null;

    if ( fs.exists(settingsPath) ) {
        try {
            var data = fs.read(settingsPath);
            readSettings = JSON.parse(data);
        } catch (err) {
            casper.die('error parsing ~/.itslrn')
        }
    }

    if (readSettings != null ) {
        settings.username = readSettings.username;
        settings.password = readSettings.password;
    }

    if ( readSettings == null || !settings.username || !settings.password ) {
        casper.die('was not able to parse username or password');
    }

    if ( casper.cli.get(0) == 'ta' ) {

        if (casper.cli.get(1) == 'download-essay') {
            var essayID = String(casper.cli.get(2));
            if (essayID) {
                baseDLPath = casper.cli.get(3) || baseDLPath;

                if (!fs.isDirectory(baseDLPath)) {
                    // TODO: maybe create folder for them?
                    casper.die('download folder "'+baseDLPath+'" did not exists')
                }

                login(settings.username, settings.password)
                TA_getAllSubmissions(essayID);
            } else {
                casper.die('need to specify essayID');
            }
        } else if (casper.cli.get(1) == 'upload-essay') {
            var essayID = String(casper.cli.get(2));
            if (essayID) {
                baseDLPath = casper.cli.get(3) || baseDLPath;

                var essayPath = TA_getEssayBasePath(essayID);

                if ( !fs.isDirectory(essayPath) ) {
                    casper.die(utils.format('essay "%s" not found in "%s"', essayID, essayPath) );
                }

                login(settings.username, settings.password);


                var inEssayPath = fs.list(essayPath);
                inEssayPath.slice(2).map(function(file) {
                    if (file != 'temp'
                        && fs.isDirectory(path.join(essayPath, file)) ) {
                        var personID = String(file);
                        var taFilePath = TA_getEssayTAFilesPath(essayID, personID);

                        if (!fs.isDirectory(taFilePath)) {
                            casper.die(utils.format('%s did not exists', taFilePath))
                        }

                        var tafiles = fs.list(taFilePath).slice(2).map(function(file){
                            return path.join(taFilePath, file);
                        })

                        upload_TA_correction_files(essayID, personID, tafiles, '')
                    }
                });

            } else {
                casper.die('need to specify essayID');
            }
        } else {
            casper.die('need to specify action');
        }
    } else {
        casper.die('need to specify mode')
    }
}

// -------------------------------------------------------------------------- //

var baseUrl = "https://absalon.itslearning.com";

// TODO: enable other policies
var duplicatePolicy = 'replace';
// var validDuplicatePolicy = ['allow', 'deny', 'replace']


var maxUploadTime = 5 * 60 * 1000;

// TODO: add casperjs as a git submodule
// git://github.com/n1k0/casperjs.git

// -------------------------------------------------------------------------- //

var dashboardURL = 'https://absalon.itslearning.com/DashboardMenu.aspx';

function login (username, password) {
    casper.thenOpen('https://absalon.itslearning.com/?LanguageId=1', function(){
        this.echo('Logging you in');
        this.sendKeys('input[placeholder="Username"]', username)
        this.sendKeys('input[placeholder="Password"]', password)
        this.thenClick('.itsl-native-login-button', function() {
            if (this.page.url.indexOf(dashboardURL) != 0) {
                this.die('Failed to log you in');
            } else {
                this.echo('Login sucessful', 'INFO')
            }
        });
    });
}

// -------------------------------------------------------------------------- //

function verifyUploadNames(currentFileNames, filePaths) {
    uploadingFileNames = []

    for (var i = 0; i < filePaths.length; i++) {
        filePath = filePaths[i];

        if( ! fs.isFile(filePath) ) {
            var msg = utils.format('Request to upload "%s" - but that was not a file', filePath);
            return msg;
        }

        fileName = path.basename(filePath);

        if (duplicatePolicy != 'allow' && uploadingFileNames.indexOf(fileName) != -1) {
            var msg = utils.format('You\'re trying to uploade two files called "%s" (not allowed)', fileName);
            return msg;
        } else {
            uploadingFileNames.push(fileName)
        }

    }

    return null;
}

function uploadFiles(filePaths) {
    for (var i = 0; i < filePaths.length; i++) {
        filePath = filePaths[i];
        var msg = utils.format('Uploading "%s"', filePath)
        casper.echo(msg);
    }

    casper.click('a[href^="/File/UploadFile"]');
    casper.waitForPopup(/./);
    casper.withPopup(/./, function() {
        for (var i = 0; i < filePaths.length; i++) {
            filePath = filePaths[i];
            casper.page.uploadFile('input[type="file"]', filePath);
        }
        casper.waitWhileSelector('input[type="submit"][disabled]', null, null, maxUploadTime);
        casper.then(function(){
            casper.thenClick('input[type="submit"]');
            casper.echo('Done uploading', 'INFO');
        });
    });
}

function ta_getCurrentFiles() {
    if( casper.exists('select#AssessForm_FileUploadControl_FileList option') ) {
        return casper.getElementsInfo('select#AssessForm_FileUploadControl_FileList option');
    }

    return [];
}

// will ignore files not present
function ta_removeFiles(filenames) {
    currentFiles = ta_getCurrentFiles();

    for(var i = 0; i < filenames.length; i++) {
        var fileName = filenames[i];

        for(var j = currentFiles.length-1; j >= 0; j--) {
            currentFile = currentFiles[j];

            if (currentFile.text == fileName) {
                var msg = utils.format('Removing already present file "%s"', fileName);
                casper.echo(msg);

                casper.evaluate(function(val) {
                    document.querySelector('select#AssessForm_FileUploadControl_FileList').value = [val];
                }, currentFile.attributes.value);

                casper.click('a[onclick*="RemoveFileFromAssessForm_File"]');

                currentFiles.splice(j, 1);
            }
        }
    }
}

function upload_TA_correction_files(essayID, personID, filePaths, newStatus) {
    if(filePaths.length == 0 && !newStatus) {
        return;
    }



    var reqUrl = 'https://absalon.itslearning.com/essay/show_essay_answer.aspx?EssayID='+essayID+'&PersonId='+personID;
    casper.thenOpen(reqUrl, function() {

        var currentFiles = ta_getCurrentFiles();

        uploadingFileNames = [];
        for (var i = 0; i < filePaths.length; i++) {
            filePath = filePaths[i];
            fileName = path.basename(filePath);
            uploadingFileNames.push(fileName);
        };

        if (duplicatePolicy == 'deny') {

            for(var i = 0; i < filenames.length; i++) {
                var fileName = filenames[i];

                for(var j = currentFiles.length-1; j >= 0; j--) {
                    currentFile = currentFiles[j];

                    if(fileName == currentFile.text) {
                        var msg = utils.format('There is already uploaded a file called "%s"', fileName);
                        casper.die(msg);
                    }
                }
            }

        } else if(duplicatePolicy == 'replace') {
            ta_removeFiles.apply(casper, [uploadingFileNames]);
        } else if(duplicatePolicy == 'allow' ) {
            // nothing
        }

        uploadFiles(filePaths);

        if (newStatus) {
            casper.then( function() {
                var possibleStatuses = casper.getElementsInfo('select#AssessForm_ctl10 option');

                for (var i = 0; i < possibleStatuses.length; i++) {
                    var possibleStatus = possibleStatuses[i];

                    if (possibleStatus.text == newStatus) {
                        casper.evaluate(function(val){
                            document.querySelector('select#AssessForm_ctl10').value = val;
                        }, possibleStatus.attributes.value);

                        var msg = utils.format('Setting status to "%s"', newStatus)
                        casper.echo(msg, 'PARAMETER')
                    }
                }
            });
        }

        casper.wait(100);
        casper.thenClick('input[name="AssessForm$FormButtons$submitbutton"]');

        casper.then( function() {
            var msg = utils.format('Done with essay %s for person %s', essayID, personID);
            casper.echo(msg, 'INFO');
        });
    });
}

// -------------------------------------------------------------------------- //

function TA_parsePersons(personInfos) {
    var nextLinkSel = 'a span.nextarrow'

    casper.page.injectJs(jQueryPath);
    var newPersonInfo = casper.evaluate(function(){
        var rows = $('tr[id^="EssayAnswers_"]').slice(1);
        var data = [];
        for( var i=0; i<rows.length; i++) {
            var row = rows[i];
            data.push( { ID: row.querySelector('input').value
                       , name: row.querySelector('a[href*="show_person"]').textContent
                       , username: row.children[2].textContent
                       , submitted: row.children[3].textContent
                       , status: row.children[5].textContent
                       , assesment: row.children[6].textContent
                       });
        }
        return data;
    });

    newPersonInfo.map(function(item){
        // TODO: more reobust checking
        item.submitted = moment(item.submitted, "DD/MM/YYYY HH:mm");
        personInfos.push(item);
    });

    if (casper.exists(nextLinkSel)) {
        casper.thenClick(nextLinkSel, function(){
            TA_parsePersons(personInfos);
        });
    }
}

function TA_downloadInfoFromEssay(essayID, personInfo) {

    // set up dirs
    var basePersonPath  = TA_getEssayPersonBasePath(essayID, personInfo.ID);
    var baseStudentPath = TA_getEssayStudentFilesPath(essayID, personInfo.ID);
    var baseTAPath      = TA_getEssayTAFilesPath(essayID, personInfo.ID);
    var personInfoPath  = TA_getEssayPersonInfoPath(essayID, personInfo.ID);

    fs.makeDirectory(basePersonPath);
    fs.makeDirectory(baseStudentPath);
    fs.makeDirectory(baseTAPath);

    var reqUrl = 'https://absalon.itslearning.com/essay/show_essay_answer.aspx?EssayID='+essayID+'&PersonId='+personInfo.ID;
    casper.thenOpen(reqUrl, function(){
        var dlLinks = []
        var dlLinkSelector = 'a[href*="/File/download.aspx"]';
        if (casper.exists(dlLinkSelector)) {
            dlLinks = casper.getElementsInfo(dlLinkSelector);
        }

        var htmlAnswerSel = 'div.essay-answer-text';
        var answerPath = path.join(basePersonPath, 'student_answer.html');
        if (casper.exists(htmlAnswerSel)) {
            var answer = casper.getElementInfo(htmlAnswerSel).html;
            var answerHtml = '<html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"/></head><body>' + answer + '</body></html>';
            fs.write(answerPath, answerHtml);
        } else if ( casper.exists(answerPath) ) {
            fs.remove(answerPath);
        }

        // if duplicates, the most recent is the lowest in the listing
        dlLinks.map(function(link){
            var dlPath = path.join(baseStudentPath,link.text)
            casper.download(link.attributes.href, dlPath);
            touch(dlPath, personInfo.submitted.format())
            casper.echo(utils.format('finished downloading "%s"', dlPath))
        });
    });

    fs.write(personInfoPath, JSON.stringify(personInfo));
}

function TA_getAllSubmissions(essayID) {
  var reqUrl = 'https://absalon.itslearning.com/essay/read_essay.aspx?EssayID='+essayID;
  casper.thenOpen(reqUrl, function () {
      casper.thenEvaluate(function(){
          var dropdown = document.querySelector('select#EssayAnswers_ctl00_ctl19_FilterCtrl')
          dropdown.value = "Submitted";
          dropdown.onchange(null);
      });

      var personInfos = [];

      fs.makeDirectory( TA_getEssayBasePath(essayID) );

      casper.then(function(){
          TA_parsePersons(personInfos);
      });

      casper.then(function(){
          this.echo(utils.format("%d submissions found (will now downlaod)", personInfos.length) );

          personInfos.map(function(perseonInfo){
              TA_downloadInfoFromEssay(essayID, perseonInfo);
          });
      });
  });
}


// -------------------------------------------------------------------------- //

function touch(path,time) {
    spawn('touch', ['-d', time, path]);
}

// -------------------------------------------------------------------------- //

function TA_getEssayBasePath(essayID) {
    return path.join(baseDLPath, essayID);
}

function TA_getEssayTempPath(essayID) {
    return path.join(TA_getEssayBasePath(essayID), 'temp');
}

function TA_getEssayZipPath(essayID, personID) {
    return path.join(TA_getEssayTempPath(essayID), personID+'.zip');
}

function TA_getEssayPersonBasePath(essayID, personID) {
    return path.join(TA_getEssayBasePath(essayID), personID);
}

function TA_getEssayStudentFilesPath(essayID, personID) {
    return path.join(TA_getEssayPersonBasePath(essayID, personID), "student_files");
}

function TA_getEssayTAFilesPath(essayID, personID) {
    return path.join(TA_getEssayPersonBasePath(essayID, personID), "ta_files");
}

function TA_getEssayPersonInfoPath(essayID, personID) {
    return path.join(TA_getEssayPersonBasePath(essayID, personID), '.itslrn-person');
}

// -------------------------------------------------------------------------- //


// Find participants of course
//https://absalon.itslearning.com/Course/Participants.aspx?CourseID=56691

// Find groups of course
// https://absalon.itslearning.com/Course/Groups.aspx?LocationId=56691&LocationType=1

// View an assignment (students see their corrections),
// (TAs gets a list of people who answered - and can answer themselves)
// https://absalon.itslearning.com/essay/read_essay.aspx?EssayID=2694527

// Answer an assignment (as student)
// https://absalon.itslearning.com/essay/answer_essay.aspx?EssayID=2694527

// Correct assignemtn (as TA)
// https://absalon.itslearning.com/essay/show_essay_answer.aspx?EssayID=2694527&PersonId=139389
// $('a[href^="/File/UploadFile"]')


casper.start('');

initializeSettings();

//casper.die('just testing settings')

//login(settings.username, settings.password);

/*
upload_TA_correction_files( '2694527'
                          , '139389'
                          , [ 'test-submissions/logisim.jar'
                            ]
                          , 'Afleveret (Submitted)'
                          //, 'Tilfredsstillende (Satisfactory)'
);
*/

//TA_getAllSubmissions('2694527');

casper.then(function() {
    //this.capture('result.png');
});

casper.run();

// TODO: Status
// $('select#AssessForm_ctl10 option')
// $('select#AssessForm_ctl10').val(3)

// TODO: Bedømmelse?
// $('input#AssessForm_ctl14_input').click()
// $('#ui-id-1 li').map(function(obj){return obj.text; })
// $('input#AssessForm_ctl14_input').val("Bestået (Passed)")
