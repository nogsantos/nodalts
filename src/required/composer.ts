import { ItemArray } from './item-array';
import { ModelArray } from './model-array';
import { Utilities } from './utilities';
import { Model } from './model';
/**
 * 
 */
export class Composer {
    private db: Model;
    private model: Model;
    private _parent;
    private _command;
    private utilities;
    /**
    * Created by Model#query, used for composing SQL queries based on Models
    * @param {Nodal.Model} Model The model class the composer is querying from
    * @param {Nodal.Composer} [parent=null] The composer's parent (another composer instance)
    */
    constructor(model: Model, parent?: Composer) {
        this.db = model.db;
        this.model = model;
        this._parent = parent || null;
        this._command = null;
        this.utilities = new Utilities();
    }
    /**
    * Given rows with repeated data (due to joining in multiple children), 
    * return only parent models (but include references to their children)
    *
    * @param {Array} rows Rows from sql result
    * @param {Boolean} grouped Are these models grouped, if so, different procedure
    * @return {Nodal.ModelArray}    
    */
    private parseModelsFromRows(rows: Array<any>, grouped?: boolean) {
        if (grouped) {
            return ItemArray.from(rows);
        }
        if (!rows.length) {
            return new ModelArray(this.model);
        }
        let keys = Object.keys(rows[0]);
        let cache = {};
        let mainCache = {};
        cache[this.model.name] = mainCache;
        let columns = keys.filter(k => k[0] !== '$');
        let columnsObject = columns.reduce((columns, k) => {
            columns[k] = null;
            return columns;
        }, {});
        let joinsObject = keys
            .filter(k => k[0] === '$')
            .reduce((joinsObject, k) => {
                let mid = k.indexOf('$', 1);
                let name = k.substring(1, mid)
                let field = k.substring(mid + 1);
                let relationship = this.model.relationship(name);
                joinsObject[name] = joinsObject[name] || {};
                let rModel = relationship.getModel()
                joinsObject[name].Model = rModel;
                cache[rModel.name] = {};
                joinsObject[name].name = name;
                joinsObject[name].key = k;
                joinsObject[name].multiple = relationship.immediateMultiple();
                joinsObject[name].columns = joinsObject[name].columns || [];
                joinsObject[name].columns.push(field);
                joinsObject[name].columnsObject = joinsObject[name].columnsObject || {};
                joinsObject[name].columnsObject[field] = null;
                joinsObject[name].cachedModel = null;
                return joinsObject;
            }, {});
        let joins = Object
            .keys(joinsObject)
            .sort((a, b) => a.length > b.length ? 1 : -1)
            .map(k => joinsObject[k]);
        let models = new ModelArray(this.model);
        rows.forEach(row => {
            let model = mainCache[row.id];
            if (!model) {
                model = mainCache[row.id] = new Model(columns.reduce((obj, k) => {
                    obj[k] = row[k];
                    return obj;
                }, columnsObject), true);
                models.push(model);
            }
            joins.forEach(join => {
                let id = row[`\$${join.name}\$id`];
                let name = join.name;
                let names = name.split('__');
                let joinName = names.pop();
                let parentName = names.join('__');
                let parentModel = parentName ? joinsObject[parentName].cachedModel : model;
                if (join.multiple) {
                    parentModel && (parentModel.joined(joinName) || parentModel.setJoined(joinName, new ModelArray(join.Model)));
                }
                if (!id) {
                    return;
                }
                let joinCache = cache[join.Model.name];
                let joinModel = join.cachedModel = joinCache[id];
                if (!joinModel) {
                    joinModel = join.cachedModel = joinCache[id] = new join.Model(join.columns.reduce((obj, k) => {
                        obj[k] = row[`\$${join.name}\$${k}`];
                        return obj;
                    }, join.columnsObject), true)
                }
                if (join.multiple) {
                    let modelArray = parentModel.joined(joinName);
                    !modelArray.has(joinModel) && modelArray.push(joinModel);
                } else {
                    parentModel.joined(joinName) || parentModel.setJoined(joinName, joinModel);
                }
            });
        });
        return models;
    }
    /**
    * Collapses linked list of queries into an array (for .reduce, .map etc)
    * @return {Array}    
    */
    private collapse() {
        let composerArray = [];
        let composer = this;
        while (composer) {
            composerArray.unshift(composer);
            composer = composer._parent;
        }
        return composerArray;
    }
    /**
     * Removes last limit command from a collapsed array of composer commands
     *
     * @param {Array} [composerArray] Array of composer commands
     * @return {Array}    
     */
    private removeLastLimitCommand(composerArray) {
        let found = composerArray.map(c => c._command && c._command.type).lastIndexOf('limit');
        (found !== -1) && composerArray.splice(found, 1);
        return composerArray;
    }
    /**
    * Gets last limit command from a collapsed array of composer commands
    * @param {Array} [composerArray] Array of composer commands
    * @return {Array}    
    */
    private getLastLimitCommand(composerArray) {
        let found = composerArray.map(c => c._command && c._command.type).lastIndexOf('limit');
        return found >= 0 ? composerArray.splice(found, 1)[0] : null;
    }
    /**
    * Determines whether this composer query represents a grouped query or not
    * @return {Boolean}    
    */
    private isGrouped() {
        return this.collapse().filter(c => c._command && c._command.type === 'groupBy').length > 0;
    }
    /**
    * Reduces an array of composer queries to a single query information object
    *
    * @param {Array} [composerArray]
    * @return {Object} Looks like {commands: [], joins: []}    
    */
    private reduceToQueryInformation(composerArray) {
        let joins = {};
        let commands = composerArray.reduce((p, c) => {
            let composerCommand = c._command || { type: 'where', data: { comparisons: [] } };
            if (composerCommand.type === 'join') {
                let curJoinName = composerCommand.data.name;
                let curJoinData = composerCommand.data.joinData;
                joins[curJoinName] = curJoinData;
                Object.keys(joins)
                    .filter(joinName => joinName !== curJoinName)
                    .forEach(joinName => {
                        if (curJoinName.indexOf(joinName) === 0) {
                            joins[curJoinName] = joins[joinName].concat(curJoinData.slice(joins[joinName].length));
                            delete joins[joinName];
                        } else if (joinName.indexOf(curJoinName) === 0) {
                            joins[joinName][curJoinData.length - 1] = curJoinData[curJoinData.length - 1];
                            delete joins[curJoinName];
                        }
                    });
                return p;
            }
            let lastCommand = p[p.length - 1];
            let command = {
                where: null,
                limit: null,
                orderBy: [],
                groupBy: [],
                aggregate: []
            };
            p.push(command);
            if (
                lastCommand && (
                    !lastCommand[composerCommand.type] ||
                    lastCommand[composerCommand.type] instanceof Array
                )
            ) {
                command = lastCommand;
                p.pop();
            }
            if (command[composerCommand.type] instanceof Array) {
                command[composerCommand.type].push(
                    Object.keys(composerCommand.data).reduce((p, c) => {
                        return (p[c] = composerCommand.data[c], p);
                    }, {})
                );
            } else {
                command[composerCommand.type] = Object.keys(composerCommand.data).reduce((p, c) => {
                    return (p[c] = composerCommand.data[c], p);
                }, {});
            }
            return p;
        }, []);
        return {
            commands: commands,
            joins: joins
        }
    }
    /**
    * Reduces an array of commands from query informtion to a SQL query
    *
    * @param {Array} [commandArray]
    * @param {Array} [includeColumns=*] Which columns to include, includes all by default
    * @return {Object} Looks like {sql: [], params: []}
    */
    private reduceCommandsToQuery(commandArray: Array<any>, includeColumns?: Array<any>) {
        let lastAggregate = null;
        return commandArray.reduce((prev, command, i) => {
            if (command.aggregate.length && command.groupBy.length) {
                lastAggregate = command.aggregate;
            }
            let table = `t${i}`;
            let multiFilter = this.db.adapter.createMultiFilter(table, command.where ? command.where.comparisons : []);
            let params = this.db.adapter.getParamsFromMultiFilter(multiFilter);
            let joins = null;
            let columns = includeColumns || lastAggregate || this.model.columnNames();
            columns = columns
                .map(c => typeof c !== 'string' ? c : { columnNames: [c], alias: c, transformation: v => v })
                .map(c => Object.keys(c).reduce((p, k) => { return (p[k] = c[k], p); }, {}));
            !command.groupBy.length && columns.forEach(c => {
                c.transformation = v => v;
                c.columnNames = [c.alias];
            });
            return {
                sql: this.db.adapter.generateSelectQuery(
                    prev.sql || { table: this.model.table() },
                    table,
                    columns,
                    multiFilter,
                    joins,
                    command.groupBy,
                    command.orderBy,
                    command.limit,
                    prev.params.length
                ),
                params: prev.params.concat(params)
            }
        }, { sql: null, params: [] });
    }
    /**
    * Retrieve all joined column data for a given join
    *
    * @param {string} joinName The name of the join relationship
    */
    private joinedColumns(joinName) {
        let relationship = this.model.relationships().findExplicit(joinName);
        return relationship.getModel().columnNames().map(columnName => {
            return {
                name: joinName,
                table: relationship.getModel().table(),
                columnNames: [columnName],
                alias: `\$${joinName}\$${columnName}`,
                transformation: v => v
            };
        });
    }
    /**
    * Generate a SQL query and its associated parameters from the current composer instance
    *
    * @param {Array} [includeColumns=*] Which columns to include, includes all by default
    * @param {boolean} [disableJoins=false] Disable joins if you just want a subset of data
    * @return {Object} Has "params" and "sql" properties.
    */
    private generateQuery(includeColumns?: Array<any>, disableJoins?: boolean) {
        disableJoins = disableJoins || this.isGrouped();
        let queryInfo = this.reduceToQueryInformation(this.collapse());
        let query = this.reduceCommandsToQuery(queryInfo.commands, includeColumns);
        return disableJoins ? query : this.addJoinsToQuery(
            query,
            queryInfo,
            includeColumns
        );
    }
    /**
    * Generate a SQL count query
    * @param {Array} [includeColumns=*] Which columns to include, includes all by default
    * @param {boolean} [disableJoins=false] Disable joins if you just want a subset of data
    * @return {Object} Has "params" and "sql" properties.
    */
    private generateCountQuery() {
        let queryInfo = this.reduceToQueryInformation(this.removeLastLimitCommand(this.collapse()));
        let query = this.reduceCommandsToQuery(queryInfo.commands);
        query.sql = this.db.adapter.generateCountQuery(query.sql, 'c');
        return query;
    }
    /**
    * Add Joins to a query from queryInfo
    * @param {Object} query Must be format {sql: '', params: []}
    * @param {Object} queryInfo Must be format {commands: [], joins: []}
    * @param {Array} [includeColumns=*] Which columns to include, includes all by default
    * @return {Object} Has "params" and "sql" properties.
    */
    private addJoinsToQuery(query: any, queryInfo: any, includeColumns?: Array<any>) {
        let columns = includeColumns || this.model.columnNames();
        let joins = queryInfo.joins;
        Object.keys(joins).forEach(joinName => {
            joins[joinName].forEach(j => {
                columns = columns.concat(this.joinedColumns(j.joinAlias));
            });
        });
        joins = Object.keys(joins).map(k => joins[k]);
        let params = query.params.slice();
        joins.forEach(join => {
            join.forEach(j => {
                params = params.concat(this.db.adapter.getParamsFromMultiFilter(j.multiFilter));
            });
        });
        // Set join OrderBys... in reverse order
        let orderBy = queryInfo.commands.reduce((arr, command) => {
            command.orderBy && (arr = command.orderBy.concat(arr));
            return arr;
        }, []);
        // When doing joins, we count paramOffset as the last where parameter length
        // Because we add in a bunch of parameters at the end.
        return {
            sql: this.db.adapter.generateSelectQuery(
                query.sql,
                'j',
                columns,
                null,
                joins,
                null,
                orderBy,
                null,
                query.params.length
            ),
            params: params
        };
    }
    /**
    * When using Composer#where, format all provided comparisons
    * @param {Object} comparisons Comparisons object. {age__lte: 27}, for example.
    * @param {Nodal.Model} Model the model to use as the basis for comparison. Default to current model.
    * @return {Array}
    */
    private parseComparisons(comparisons: any, Model?: Model) {
        Model = Model || this.model;
        let comparators = this.db.adapter.comparators;
        let columnLookup = Model.columnLookup();
        return Object.keys(comparisons)
            .map(comparison => {
                let column = comparison.split('__');
                let rel = null;
                let joinName;
                let comparator = column.pop();
                if (!comparators[comparator]) {
                    column.push(comparator);
                    comparator = 'is';
                }
                if (column.length > 1) {
                    joinName = column.slice(0, column.length - 1).join('__');
                    rel = Model.relationship(joinName);
                    column = column.slice(column.length - 1);
                }
                let table = null;
                let joined = false;
                let joins = null;
                if (rel) {
                    // if it's not found, return null...
                    if (!rel.getModel().hasColumn(column[0])) {
                        return null;
                    }
                    table = rel.getModel().table();
                    joined = true;
                    joins = rel.joins('w');
                }
                let columnName = column[0];
                // block out bad column names
                if (!rel && !Model.hasColumn(columnName)) {
                    return null;
                }
                return {
                    table: table,
                    columnName: columnName,
                    comparator: comparator,
                    value: comparisons[comparison],
                    joined: joined,
                    joins: joins
                };
            })
            .filter(v => {
                return !!v;
            });
    }
    /**
     * 
     */
    private filterHidden(Model: Model, comparisonsArray?: Array<any>) {
        comparisonsArray = (comparisonsArray || []).filter(c => c);
        let comparators = this.db.adapter.comparators;
        return comparisonsArray.map(comparisons => {
            Object.keys(comparisons).forEach(comparison => {
                let cModel = Model;
                let column = comparison.split('__');
                let comparator = column.pop();
                !comparators[comparator] && column.push(comparator);
                let field = column.pop();
                let relName = column.join('__');
                if (relName) {
                    let rel = cModel.relationship(relName);
                    if (!rel) {
                        return;
                    }
                    cModel = rel.getModel();
                }
                if (cModel.isHidden(field)) {
                    delete comparisons[comparison];
                }
            });
            if (Object.keys(comparisons).length === 0) {
                return null;
            }
            return comparisons;
        }).filter(comparisons => comparisons);
    }
    /**
    * Add comparisons to SQL WHERE clause. Does not allow filtering if Model.hides() has been called.
    * @param {Object} comparisons Comparisons object. {age__lte: 27}, for example.
    * @return {Nodal.Composer} new Composer instance
    */
    safeWhere(comparisonsArray) {
        if (!(comparisonsArray instanceof Array)) {
            comparisonsArray = [].slice.call(arguments);
        }
        return this.where(
            this.filterHidden(
                this.model,
                comparisonsArray
            )
        );
    }
    /**
    * Join in a relationship. Filters out hidden fields from comparisons.
    * @param {string} joinName The name of the joined relationship
    * @param {array} comparisonsArray comparisons to perform on this join (can be overloaded)
    */
    safeJoin(joinName, comparisonsArray) {
        if (!(comparisonsArray instanceof Array)) {
            comparisonsArray = [].slice.call(arguments, 1);
        }
        let relationship = this.model.relationship(joinName);
        if (!relationship) {
            return this;
        }
        return this.join(
            joinName,
            this.filterHidden(
                relationship.getModel(),
                comparisonsArray
            )
        );
    }
    /**
    * Add comparisons to SQL WHERE clause.
    * @param {Object} comparisons Comparisons object. {age__lte: 27}, for example.
    * @return {Nodal.Composer} new Composer instance
    */
    where(comparisonsArray) {
        if (!(comparisonsArray instanceof Array)) {
            comparisonsArray = [].slice.call(arguments);
        }
        comparisonsArray = comparisonsArray.map(comparisons => {
            return Object.keys(comparisons).reduce((p, c) => { return (p[c] = comparisons[c], p); }, {});
        });
        let order = null;
        let offset = null;
        let count = null;
        comparisonsArray.forEach(comparisons => {
            if ('__order' in comparisons) {
                order = comparisons.__order.split(' ');
                delete comparisons.__order;
            }
            if ('__offset' in comparisons || '__count' in comparisons) {
                offset = comparisons.__offset;
                count = comparisons.__count;
                delete comparisons.__offset;
                delete comparisons.__count;
            }
        });
        if (order || offset || count) {
            let composer = this;
            order && (composer = composer.orderBy(order[0], order[1]));
            (offset || count) && (composer = composer.limit(offset || 0, count || 0));
            return composer.where(comparisonsArray);
        }
        this._command = {
            type: 'where',
            data: {
                comparisons: comparisonsArray
                    .map(comparisons => this.parseComparisons(comparisons))
                    .filter(f => f.length)
            }
        };
        return new Composer(this.model, this);
    }
    /**
    * Order by field belonging to the current Composer instance's model.
    * @param {string} field Field to order by
    * @param {string} direction Must be 'ASC' or 'DESC'
    * @return {Nodal.Composer} new Composer instance
    */
    orderBy(field, direction) {
        let transformation;
        let fields = [];
        if (typeof field === 'function') {
            fields = this.utilities.getFunctionParameters(field);
            transformation = field;
        } else {
            fields = [field];
            transformation = v => `${v}`;
        }
        fields.forEach(field => {
            if (!this.model.hasColumn(field)) {
                throw new Error(`Cannot order by ${field}, it does not belong to ${this.model.name}`);
            }
        });
        this._command = {
            type: 'orderBy',
            data: {
                columnNames: fields,
                transformation: transformation,
                direction: ({ 'asc': 'ASC', 'desc': 'DESC' }[(direction + '').toLowerCase()] || 'ASC')
            }
        };
        return new Composer(this.model, this);
    }
    /**
    * Limit to an offset and count
    * @param {number} offset The offset at which to set the limit. If this is the only argument provided, it will be the count instead.
    * @param {number} count The number of results to be returned. Can be omitted, and if omitted, first argument is used for count.
    * @return {Nodal.Composer} new Composer instance
    */
    limit(offset: number, count?: number) {
        if (this._command) {
            return new Composer(this.model, this).limit(offset, count);
        }
        if (count === undefined) {
            count = offset;
            offset = 0;
        }
        this._command = {
            type: 'limit',
            data: {
                count: count,
                offset: offset
            }
        };
        return new Composer(this.model, this);
    }
    /**
    * Join in a relationship.
    * @param {string} joinName The name of the joined relationship
    * @param {array} comparisonsArray comparisons to perform on this join (can be overloaded)
    */
    join(joinName, comparisonsArray) {
        if (!(comparisonsArray instanceof Array)) {
            comparisonsArray = [].slice.call(arguments, 1);
        }
        let relationship = this.model.relationships().findExplicit(joinName);
        if (!relationship) {
            throw new Error(`Model ${this.model.name} does not have relationship "${joinName}".`);
        }
        let composer = this;
        while (composer) {
            if (composer._command && composer._command.type === 'join' && composer._command.data.name === joinName) {
                return this;
            }
            composer = composer._parent;
        }
        let joinData = relationship.joins();
        joinData[joinData.length - 1].joinAlias = joinName;
        joinData[joinData.length - 1].prevAlias = joinName.split('__').slice(0, -1).join('__');
        joinData[joinData.length - 1].multiFilter = this.db.adapter.createMultiFilter(
            joinName,
            comparisonsArray
                .map(comparisons => this.parseComparisons(comparisons, relationship.getModel()))
                .filter(f => f.length)
        );
        this._command = {
            type: 'join',
            data: {
                name: joinName,
                joinData: joinData
            }
        };
        return new Composer(this.model, this);
    }
    /**
    * Groups by a specific field, or a transformation on a field
    * @param {String} column The column to group by
    */
    groupBy(column) {
        let columns;
        let transformation;
        if (typeof column === 'function') {
            columns = this.utilities.getFunctionParameters(column);
            transformation = column;
        } else {
            columns = [column]
            transformation = v => `${v}`;
        }
        this._command = {
            type: 'groupBy',
            data: {
                columnNames: columns,
                transformation: transformation
            }
        };
        return new Composer(this.model, this).aggregate(column);
    }
    /**
    * Aggregates a field
    * @param {String} alias The alias for the new aggregate field
    * @param {Function} transformation The transformation to apply to create the aggregate
    */
    aggregate(alias, transformation) {
        let columns;
        if (typeof transformation === 'function') {
            columns = this.utilities.getFunctionParameters(transformation);
        } else {
            columns = [alias]
            transformation = v => v;
        }
        this._command = {
            type: 'aggregate',
            data: {
                alias: alias,
                columnNames: columns,
                transformation: transformation
            }
        };
        return new Composer(this.model, this);
    }
    /**
    * Execute the query you've been composing.
    * @param {function({Error}, {Nodal.ModelArray})} callback The method to execute when the query is complete
    */
    end(callback) {
        let query = this.generateQuery();
        let countQuery = this.generateCountQuery();
        let grouped = this.isGrouped();
        let limitCommand = this.getLastLimitCommand(this.collapse());
        let offset = limitCommand ? limitCommand._command.data.offset : 0;
        let total = 0;
        this.db.query(countQuery.sql, countQuery.params, (err, result) => {
            let total = (((result && result.rows) || [])[0] || {}).__total__ || 0;
            if (!total) {
                let models = this.parseModelsFromRows([], grouped);
                models.setMeta({ offset: offset, total: total });
                return callback.call(this, err, models);
            }
            this.db.query(query.sql, query.params, (err, result) => {
                let rows = result ? (result.rows || []).slice() : [];
                let models = this.parseModelsFromRows(rows, grouped);
                models.setMeta({ offset: offset, total: total });
                callback.call(this, err, models);
            });
        });
    }
    /**
    * Shortcut for .limit(1).end(callback) that only returns a model object or error if not found
    * @param {Function} callback Callback to execute, provides an error and model parameter
    */
    first(callback) {
        return this.limit(1).end((err, models) => {
            if (!err && !models.length) {
                err = new Error(`No records for ${this.model.name} found in your query`);
            }
            callback(err, models[0]);
        });
    }
    /**
    * Execute query as an update query, changed all fields specified.
    * @param {Object} fields The object containing columns (keys) and associated values you'd like to update
    * @param {function({Error}, {Nodal.ModelArray})} callback The callback for the update query
    */
    update(fields: any, callback?: Function) {
        if (this.isGrouped()) {
            throw new Error('Cannot update grouped queries');
        }
        let query = this.generateQuery(['id'], true);
        let columns = Object.keys(fields);
        let params = columns.map(c => fields[c]);
        query.sql = this.db.adapter.generateUpdateAllQuery(
            this.model.table(),
            'id',
            columns,
            query.params.length,
            query.sql
        );
        query.params = query.params.concat(params);
        return this.db.query(query.sql, query.params, (err, result) => {
            let rows = result ? (result.rows || []).slice() : [];
            if (err) {
                let models = this.parseModelsFromRows(rows);
                return callback.call(this, err, models);
            }
            let ids = result.rows.map(row => row.id);
            /* Grab all items with ids, sorted by order */
            /* Only need to grab joins and order */
            let composerArray = this.collapse()
                .filter(composer => composer._command)
                .filter(composer => composer._command.type === 'orderBy' || composer._command.type === 'join');
            // Add in id filter
            composerArray.unshift(new Composer(this.model).where({ id__in: ids })._parent);
            let queryInfo = this.reduceToQueryInformation(composerArray);
            let query = this.reduceCommandsToQuery(queryInfo.commands);
            query = this.addJoinsToQuery(query, queryInfo);
            return this.db.query(query.sql, query.params, (err, result) => {
                let rows = result ? (result.rows || []).slice() : [];
                let models = this.parseModelsFromRows(rows);
                callback.call(this, err, models);
            });
        });
    }
}