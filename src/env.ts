import * as process from "process";
/**
 * 
 */
export class Env {

    constructor() {
        return {
            name: process.env.NODE_ENV || 'development',
            rootDirectory: process.env.ROOT_DIRECTORY || process.cwd()
        }
    }
}