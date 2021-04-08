Open source facet.

The intention of this article is to show the process of refactoring java code on a real-life case study. I'm going to give an overview of the initial state -- and what was wrong about it, depict the steps I've undertaken in order to give the project some rational structure, and sum up with some conclusions.

[This git repository](https://github.com/rspective/elasticsearch-river-couchdb "this open-source git repository") will serve as a reference for this article. It holds the history of a certain open-source software project, that I'm going to introduce to you, beginning with the original state when it's been forked, along with a heavy redesign, till up to my last polishing touch. Within this post I'll be linking to particular commits, but to have the complete picture, I recommend that you have a peek at [git history](https://github.com/rspective/elasticsearch-river-couchdb/commits?page=2) out there.

The problem we faced.

The problem we faced.

In our project, [CouchDb](http://couchdb.apache.org/ "CouchDb") would serve as a NOSQL database to store some JSON documents. We needed to provide full-text search functionality on the metadata stored in the database.[Elasticsearch](http://www.elasticsearch.org/) seemed to be a perfect fit, as it uses the same schema-less JSON representations and is really easy to set up. What's more, it was designed to be extensible with plugins. And luckily, there's a bunch of open source plugins out there, including this [elasticsearch-river-couchdb](https://github.com/elasticsearch/elasticsearch-river-couchdb) which helps to integrate CouchDb with the search engine.

CouchDb has this useful *changes' feed API*, which lets you read all document changes that have taken place since some point in time (per database). You could think of it as a transaction log exposed via HTTP API (despite that CouchDb is not transactional). So -- in a nutshell -- the mentioned elasticsearch-river-couchdb plugin would simply listen to the changes' feed and index all incoming events to a respective elasticsearch index.

This has worked for us for quite some time, but after a while our document structures changed in the way that a logical entity would now consist of two documents in CouchDb, which had to be merged into a single document in the search index, following some custom rules and filters. Elasticsearch-river-couchdb was no longer sufficient for our requirements. We did a little research, but didn't find any other plugin that would help us deal with the problem out-of-the-box. So we've made a decision to write our own custom river plugin. It was natural for us to start the development basing on the original one, but we soon realized that the code would have to be completely rewritten or at least heavily refactored. And here the story begins.

What it used to look like.

-   Face it. 500+ lines of sad & solid spaghetti: [CouchdbRiver.java](https://github.com/elasticsearch/elasticsearch-river-couchdb/blob/master/src/main/java/org/elasticsearch/river/couchdb/CouchdbRiver.java)
    -   Very low level of abstraction making the code hardly comprehensible,
        -   why would the main class care about wiring up a [HostnameVerifier](https://github.com/elasticsearch/elasticsearch-river-couchdb/blob/master/src/main/java/org/elasticsearch/river/couchdb/CouchdbRiver.java#L463) for some connection?
        -   why would the main class know exactly [how to parse some property value](https://github.com/elasticsearch/elasticsearch-river-couchdb/blob/master/src/main/java/org/elasticsearch/river/couchdb/CouchdbRiver.java#L354)coming from both CouchBase and CouchDb?
    -   DRY violations, e.g.:
        -   9 duplications of:

            `if` `(closed) {`

            `return``;`

            `}`

        -   3 duplications of something similar to this:

            `try` `{`

            `file = file + ``"&amp;since="` `+ URLEncoder.encode(lastSeq, ``"UTF-8"``);`

            `} ``catch` `(UnsupportedEncodingException e) {`

            `// should not happen, but in any case...`

            `file = file + ``"&amp;since="` `+ lastSeq;`

            `}`

        -   the default for every configuration property is always declared twice (see [the constructor](https://github.com/elasticsearch/elasticsearch-river-couchdb/blob/master/src/main/java/org/elasticsearch/river/couchdb/CouchdbRiver.java#L96))
    -   closed for extension & open for modification,
        -   Well, technically one could extend the functionality by passing some scripts via configuration. But hardly anybody would manage to extend the existing classes, meaning that the only way would be to modify its sources. To tell the truth, it wasn't so "open" or "inviting" for modifications either =).
        -   To be more specific about the problem -- how do I reuse the existing code to allow e.g. fetching change events from two CouchDb databases?
    -   No OOP, no encapsulation, no SRP, low cohesion, tight coupling:
        -   A [single class](https://github.com/elasticsearch/elasticsearch-river-couchdb/blob/master/src/main/java/org/elasticsearch/river/couchdb/CouchdbRiver.java) hermetically coupled with two inner classes communicating over a set of shared variables, covering more or less everything,
    -   A mess of conditions, try-catch-finally blocks and loops, all forming up a visually abstract quartet of mountain-shaped methods,
    -   Error-handling logic duplicated everywhere, yet not making the code look particularly stable & safe,
        -   a snippet from [here](https://github.com/elasticsearch/elasticsearch-river-couchdb/blob/master/src/main/java/org/elasticsearch/river/couchdb/CouchdbRiver.java#L491 "here"):

            `try` `{`

            `// ~50 LoC here`

            `} ``catch` `(Exception e) {`

            `try` `{`

            `Closeables.close(is, ``true``);`

            `} ``catch` `(IOException e1) {`

            `// Ignore`

            `}`

            `if` `(connection != ``null``) {`

            `try` `{`

            `connection.disconnect();`

            `} ``catch` `(Exception e1) {`

            `// ignore`

            `} ``finally` `{`

            `connection = ``null``;`

            `}`

            `}`

            `if` `(closed) {`

            `return``;`

            `}`

            `logger.warn(``"failed to read from _changes, throttling...."``, e);`

            `try` `{`

            `Thread.sleep(``5000``);`

            `} ``catch` `(InterruptedException e1) {`

            `if` `(closed) {`

            `return``;`

            `}`

            `}`

            `} ``// finally ....`

-   No tests, at least none which would actually test something,
    -   instead: two *main()* methods which might prove useful for debugging, e.g.[CouchdbRiverTest.java](https://github.com/elasticsearch/elasticsearch-river-couchdb/blob/master/src/test/java/org/elasticsearch/river/couchdb/CouchdbRiverTest.java)

        `public` `static` `void` `main(String[] args) ``throws` `Exception {`

        `Node node = NodeBuilder.nodeBuilder().settings(ImmutableSettings.settingsBuilder().put(``"gateway.type"``, ``"local"``)).node();`

        `Thread.sleep(``1000``);`

        `node.client().prepareIndex(``"_river"``, ``"db"``, ``"_meta"``).setSource(jsonBuilder().startObject().field(``"type"``, ``"couchdb"``).endObject()).execute().actionGet();`

        `Thread.sleep(``1000000``);`

        `}`

Preparations.

I started my work by getting this stuff to compile & run. I also decided to upgrade the dependencies' versions, so that I could work with the newest ones. I also switched from TestNG to JUnit, because I simply prefer the latter. Since there were no tests in the project anyway, the change didn't break anything.

Configuration.

The first programmatic challenge was to refactor the configuration part. At first glance, the configuration could be split into three pieces:

-   stuff related to CouchDb connection (URL, credentials) => [CouchdbConnectionConfig.java](https://github.com/rspective/elasticsearch-river-couchdb/blob/da04e276fef6462eb7257e9a2fe945cd60b9b052/src/main/java/org/elasticsearch/river/couchdb/CouchdbConnectionConfig.java)
-   stuff related to fetching data from CouchDb (database name, filtering, scripts, etc.) =>[CouchdbDatabaseConfig.java](https://github.com/rspective/elasticsearch-river-couchdb/blob/da04e276fef6462eb7257e9a2fe945cd60b9b052/src/main/java/org/elasticsearch/river/couchdb/CouchdbDatabaseConfig.java)
-   elasticsearch-index-specific properties => [IndexConfig.java](https://github.com/rspective/elasticsearch-river-couchdb/blob/da04e276fef6462eb7257e9a2fe945cd60b9b052/src/main/java/org/elasticsearch/river/couchdb/IndexConfig.java)

Along with extracting those classes, I added a bunch of unit tests to ensure that properties are set properly for various combinations. In effect, I did a bit more than a mere refactoring. I decided to draw the lines there a bit different, to facilitate reading multiple CouchDb feeds at once (CouchDb provides one feed per database). After I integrated my changes with the God class, it's constructor immediately got much thinner -- from ~80 LoC to ~5 LoC. Also, I've written a Helpers' class, with a bunch of static methods. While it's certainly not a good OO design, it helps to make the code cleaner especially when called with static imports.

God class.

With [this commit](https://github.com/rspective/elasticsearch-river-couchdb/commit/fdd533dd09fd9a511805597d0bf6b7a88605074b) I bundled the worker threads into a list, again -- to facilitate managing them if there are more of them in future. The [subsequent commit](https://github.com/rspective/elasticsearch-river-couchdb/commit/6aa35c168c93cc18569943c64371e168adea2144) introduced retrying of elasticsearch index creation on river initialization. Hopefully it makes the plugin more reliable when booting up. Interestingly, I came up with a possibly controversial [Sleeper class](https://github.com/rspective/elasticsearch-river-couchdb/blob/6aa35c168c93cc18569943c64371e168adea2144/src/main/java/org/elasticsearch/river/couchdb/util/Sleeper.java) to improve code comprehension and support the DRY principle.

Extracting Slurper.

The general concept of elasticsearch-couchdb-river consisted of two major components:

-   slurper object -- for fetching data from CouchDb changes' feed
-   indexer object -- for persisting those changes in elasticsearch index

There was a class called Slurper already, but since the class felt like it could be a completely independent piece, I wanted to take it out from the giant knot it's been rooted into. [The very first step](https://github.com/rspective/elasticsearch-river-couchdb/commit/fbb57914c111fe43d92409ca3dfe078ff195e25b) was not very exciting, as it was a mere cut & paste & make it compile again. It wasn't very effective either, as my new class still had lots of injected dependencies. This was to be fixed in next steps.

I decided to focus a bit on the Slurper, so I divided the monster method into smaller pieces and gave it pretty descriptive naming.

Next thing I did was [extraction of another class](https://github.com/rspective/elasticsearch-river-couchdb/commit/ecf4e65aef02ba044c9ea649b0710af31e3e8a75), responsible for reading "*last_seq*" number from elasticsearch index. To give some explanations -- every time the river successfully processes a change event, it saves its sequence number under "*last_seq*" in elasticsearch index. It serves as a marker, so that e.g. in case of HTTP connection error the river knows where to start fetching change events from CouchDb again. Now the class was small enough to cover it with some [unit tests](https://github.com/rspective/elasticsearch-river-couchdb/commit/33f187357e891dd2bbb0a4bfeb8e398edd2ec0cb).

I had a feeling that those string operations constructing URLs for changes' in Slurper violated SRP rule, so I [extracted a dedicated class](https://github.com/rspective/elasticsearch-river-couchdb/commit/06b69b57ebf26b55ffc03e1374a112e19050a894) to handle that. It was atomic enough to be unit-tested.

Then I spent some more effort on refactoring Slurper, with all of it's complicated HTTP connection stuff (see [here](https://github.com/rspective/elasticsearch-river-couchdb/commit/b12c0fd2070404a9f917c9c6f7626669ad3af838) and [there](https://github.com/rspective/elasticsearch-river-couchdb/commit/0a6527144e69947f856cad16bd29ff51ac03df22)). I've cut the monolithic code into smaller chunks and named them adequately to give a better context information. My [next move](https://github.com/rspective/elasticsearch-river-couchdb/commit/d9179c321b1703a6392c2d8fd18c1b291e875d1c) was mainly about extracting the HTTP communication specific part of Slurper to a dedicated class. I actually went a step further and extracted a tiny SRP-aligned class to handle change events coming from CouchDB. To avoid having dozens of classes end up in the same package, I put the slurping-related stuff where it belongs -- to *o.e.r.c.kernel.slurp*.

See the pattern already? It turns out that refactoring in this case is all about extracting classes, dividing monolith methods into smaller blocks and naming them right to give more context description. The goal is to have relatively small components of single responsibility. To achieve that, it's good to allow them to be lazy -- i.e. let them delegate work to others. What it gives is easy testability, levels of abstractions and much more.

Extracting Indexer.

Similar story [here](https://github.com/rspective/elasticsearch-river-couchdb/commit/c16ced9463a4152d583981f94ba12bbbbd19618c). Cut & paste & make it compile again. ~200 LoC drawn out from the God class.

On my way through refactoring, I spotted the need for a [dedicated class](https://github.com/rspective/elasticsearch-river-couchdb/commit/748ef29e98450b543fe2187600fa3d6ac265cb82) for dealing with CouchDb "*last_seq*" formatting. I ensured myself that it works perfectly with a unit test.

Another ideal candidate for extraction was a component that would decide how to process incoming change events -- i.e. how to manipulate their properties, and how to deal with some common situations (e.g. *_deleted* documents), and finally -- how to persist them in elasticsearch index (see [here](https://github.com/rspective/elasticsearch-river-couchdb/commit/5833f8bfce5aa8cc3a98216525799a5d6952c3d0)). Having slimmed down the Indexer class itself, I was ready to cover it with some[unit tests](https://github.com/rspective/elasticsearch-river-couchdb/commit/06242f1b331335557d794e9ba1ca4556fe828d5f).

My next thought was to encapsulate the part where the Indexer would "spin" a bit to get some more change events for a bulk request. Be it the [ChangeCollector](https://github.com/rspective/elasticsearch-river-couchdb/commit/973bed0bc0c661bd28088909c8d8fb605f1e5372), unit-tested, naturally.

Remember the change processor thing that I mentioned? It was too fat for my liking. [Delete- and update-hooks](https://github.com/rspective/elasticsearch-river-couchdb/commit/944f6aa6a20b278d1a4a3f72b320696c62104286) surely were a way to improve extensibility and partition code into smaller testable blocks.

Final improvements.

In the meantime, I did some minor optimizations about how bulk requests are issued, also put some pressure on richer logging. As there were quite a few places where I created various requests with elasticsearch builder interface, I came up with an idea of hiding the complexity behind a [convenient factory object](https://github.com/rspective/elasticsearch-river-couchdb/commit/0c28a9df232fd6695d64d023b05fdd9be54c092a). Quite similarly -- I've coded an [abstraction layer over elasticsearch client](https://github.com/rspective/elasticsearch-river-couchdb/commit/c4309d0fef45c9e56a56a3e29b8393e6e56aa38f). I've been using it in several places, every time the call chains being quite complex. This step proved decidedly useful, because it also made my testing much simpler -- stubbing the fluent interface of the client was quite problematic and not future-proof. This way I got rid of that clumsy partially mocked *LastSeqReader* in it's respective unit test.

Another feature that I brought into the project is [retrying of failed bulk requests](https://github.com/rspective/elasticsearch-river-couchdb/commit/73795a8ea87b211cfbc2b7f0658e8908b55f571e) issued against elasticsearch. I headed for a solution that would leave the door open for others to easily customize the behavior. A retry handler (could be turned into a strategy pattern) and some command objects did the job well enough.

To give it a final polishing glance, I've implemented an [integration test](https://github.com/rspective/elasticsearch-river-couchdb/commit/941d15e138c324ec92c1126e69004d60fb8f1f3b) which requires a CouchDB instance in order to be executed. It's actually more like a smoke test, covering only the elementary functionality of the river. It creates a test CouchDB database and saves a document in it, on the other hand it boots up an in-memory elasticsearch server along with the river plugin, configures it to poll for changes from that database, and waits until the document shows up in the elasticsearch test index. The test gives me an immediate feedback about whether the river is fully functional in a real environment. This saves lots of time. It doesn't last longer than a few seconds to run it. On the other hand, manual installation of the river, restarting elasticsearch server and testing by hand with curl or some other tools could take a few minutes.

Explanations.

You could ask -- *How do you know that after each refactoring step the code did the same job as before?* The question should rather be -- *How did you know what the code was meant to do at the beginning?*

Well, after I had understood the general idea of slurpers and indexers, on my way skimming through the code I've been focusing on those small parts which seemed right to be pulled out of the rest. As soon as I grasped the idea of those tiny pieces, I could cover them with tests and do some more refactoring work. Only after I had the tests in place, I knew how those particular pieces would behave.

So in this case, it's something slightly different than the original Red/Green/Refactor cycle. I couldn't write a test up front, because it was hard to understand what the code actually did as a whole. Only after I pulled out certain parts, I could understand their intention and cover them with tests. If the tests were green, I could proceed and refactor. And pretty much repeat the cycle a few more times.

It's good to notice that I usually didn't write tests for the enclosing class before I extracted some of its parts. That's because I found it unreasonable -- I would spend X times as much time and not get any real value (because what can you break with a mere cut-paste?).

Mission complete.

Non-functional changes:

-   Clean code. Cohesive classes with single responsibilities,
-   Easy to read => Easy to understand => Easy to write,
-   Different levels of abstraction. Now it feels like building a greater solution out of primitive atomic building blocks, rather than a low-level network of variables enclosing the whole project,
-   Unit & integration tests => less bugs and clearly defined rules,
-   Open for extension, closed for modification,
-   Prepared to handle multiple databases and indices,
-   Custom processing of change events facilitated from a programmatic point of view.

Functional changes:

-   Conditional retrying failed bulk requests to elasticsearch,
-   10 attempts create elasticsearch index on river initialization,
-   Configuration slightly refined.

What value does it bring for the development team to have quality code?

Unit tests assure you that the core parts will work flawlessly. Any time you introduce changes in the code, the tests give you instantaneous and reliable feedback about how that affects the existing parts. Therefore unit tests will let you deliver subsequent features quicker.

Lesser probability of bugs means healthier project (not only code-wise). Finally, unit tests oblige you to write clean code, with nicely defined responsibilities and boundaries. That makes it certainly easy to understand and maintain.

Another aspect is fun. Nobody wants to contribute to a mess. Clean code makes the project more attractive for the dev guys and helps keep the overall morale high.
