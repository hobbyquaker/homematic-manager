module.exports = function(grunt) {

    grunt.initConfig({
        pkg: grunt.file.readJSON('package.json'),
        uglify: {
            build: {
                files: {
                    'www/js/jquery-ui-1.10.4~1.min.js': ['www/js/jquery-ui-1.10.4~1.js'],
                    'www/js/jquery.multiselect-1.13~1.min.js': ['www/js/jquery.multiselect-1.13~1.js']
                }
            }
        }
    });

    // Load the plugin that provides the "uglify" task.
    grunt.loadNpmTasks('grunt-contrib-uglify');

    // Default task(s).
    grunt.registerTask('default', ['uglify']);

};